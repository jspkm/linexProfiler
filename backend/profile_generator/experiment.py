import threading
import uuid
from typing import Any, Dict, List, Optional
from datetime import datetime
from pydantic import BaseModel
import json

from config import GEMINI_API_KEY, MODEL
from models.profile_catalog import ProfileCatalog, CanonicalProfile
from profile_generator.versioning import load_catalog
from profile_generator.incentive_manager import load_or_seed_default, get_incentive_cost_map
from profile_generator.firestore_client import (
    fs_save_experiment,
    fs_load_experiment,
    fs_list_experiments,
    fs_delete_experiment,
    fs_load_incentive_set,
)
from google import genai
from google.genai import types

try:
    _gemini = genai.Client(api_key=GEMINI_API_KEY)
except Exception:
    _gemini = None

# Global in-memory state for experiments
_experiments: Dict[str, "ExperimentState"] = {}


class ProfileIncentiveEvaluation(BaseModel):
    profile_id: str
    selected_incentives: List[str]
    gross_ltv: float
    estimated_cost: float
    net_ltv: float
    reasoning: str

class ExperimentResult(BaseModel):
    profile_id: str
    selected_incentives: List[str]
    original_portfolio_ltv: float
    new_gross_portfolio_ltv: float
    portfolio_cost: float
    new_net_portfolio_ltv: float
    lift: float
    reasoning: str

class ExperimentState(BaseModel):
    experiment_id: str
    catalog_version: str
    incentive_set_version: str = ""
    status: str  # "running", "completed", "failed", "cancelled"
    progress: int  # 0 to 100
    current_step: str
    iterations_per_profile: int
    available_incentives: List[Dict[str, Any]]
    results: List[ExperimentResult] = []
    error: Optional[str] = None
    started_at: datetime
    completed_at: Optional[datetime] = None
    cancelled: bool = False

def _strip_fences(raw: str) -> str:
    if not raw.startswith("```"):
        return raw
    lines = raw.split("\n")
    clean = []
    in_block = False
    for line in lines:
        if line.startswith("```") and not in_block:
            in_block = True
            continue
        if line.startswith("```") and in_block:
            break
        if in_block:
            clean.append(line)
    return "\n".join(clean)

def evaluate_incentive_bundle(
    profile: CanonicalProfile,
    incentives: list[dict],
    cost_map: dict[str, float],
) -> ProfileIncentiveEvaluation:
    """Ask LLM for optimal bundle with per-incentive marginal LTV, then
    programmatically keep only net-positive incentives."""
    if not _gemini:
        return ProfileIncentiveEvaluation(
            profile_id=profile.profile_id,
            selected_incentives=[],
            gross_ltv=profile.ltv,
            estimated_cost=0.0,
            net_ltv=profile.ltv,
            reasoning="No Gemini client"
        )

    system_prompt = (
        "You are an expert financial analyst optimizing credit card portfolio LTV. "
        "Given a canonical behavioral profile and available incentive programs, "
        "select the OPTIMAL BUNDLE that maximizes NET LTV (Gross LTV minus Total Cost). "
        "For EACH incentive you select, estimate its individual marginal_ltv — the "
        "incremental annual LTV it alone would add to the baseline. "
        "Output ONLY a JSON object with this exact structure: {"
        "\"selected_incentives\": [{\"name\": \"<incentive_name>\", \"marginal_ltv\": <float>}, ...], "
        "\"gross_ltv\": <float>, "
        "\"estimated_cost\": <float>, "
        "\"net_ltv\": <float>, "
        "\"reasoning\": \"<string>\"}"
    )

    incentives_text = "\n".join(
        [f"- {inc['name']} (Effective Cost: ${round(inc['estimated_annual_cost_per_user'] * inc['redemption_rate'], 2)}/yr, redemption: {int(inc['redemption_rate']*100)}%)" for inc in incentives]
    )

    user_prompt = f"""
Profile Information:
ID: {profile.profile_id}
Label: {profile.label}
Description: {profile.description}
Baseline Per-User LTV: ${profile.ltv:.2f}

Behavioral Feature Centroid:
{json.dumps(profile.centroid, indent=2)}

Available Incentives:
{incentives_text}

Task:
1. Review the profile's spending behavior (recency, frequency, spend_intensity, refunds).
2. Select incentives that will drive enough incremental spend to exceed their cost.
3. For EACH selected incentive, estimate its marginal_ltv (the incremental LTV it adds).
4. Only include incentives where marginal_ltv > cost.
5. Gross LTV = Baseline + sum of all marginal_ltv values.
"""

    try:
        response = _gemini.models.generate_content(
            model=MODEL,
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.4,
                response_mime_type="application/json",
            ),
        )

        raw_resp = _strip_fences(response.text.strip())
        data = json.loads(raw_resp)
        raw_selected = data.get("selected_incentives", [])
        reasoning = data.get("reasoning", "No reasoning provided.")
    except Exception as e:
        return ProfileIncentiveEvaluation(
            profile_id=profile.profile_id,
            selected_incentives=[],
            gross_ltv=profile.ltv,
            estimated_cost=0.0,
            net_ltv=profile.ltv,
            reasoning=f"LLM error: {e}",
        )

    # --- Programmatic filter: keep only net-positive incentives ---
    kept: list[str] = []
    kept_marginal_sum = 0.0
    kept_cost_sum = 0.0
    dropped: list[str] = []

    for inc in raw_selected:
        # Handle both dict (with marginal_ltv) and plain string formats
        if isinstance(inc, dict):
            name = inc.get("name", "")
            marginal = float(inc.get("marginal_ltv", 0.0))
        else:
            name = str(inc)
            marginal = 0.0

        cost = cost_map.get(name, 0.0)

        if marginal > cost:
            kept.append(name)
            kept_marginal_sum += marginal
            kept_cost_sum += cost
        else:
            dropped.append(f"{name} (marginal ${marginal:.2f} <= cost ${cost:.2f})")

    gross_ltv = profile.ltv + kept_marginal_sum
    net_ltv = gross_ltv - kept_cost_sum

    if dropped:
        reasoning += f" | Dropped net-negative: {'; '.join(dropped)}"

    return ProfileIncentiveEvaluation(
        profile_id=profile.profile_id,
        selected_incentives=kept,
        gross_ltv=round(gross_ltv, 2),
        estimated_cost=round(kept_cost_sum, 2),
        net_ltv=round(net_ltv, 2),
        reasoning=reasoning,
    )


def _enforce_baseline(
    evaluation: ProfileIncentiveEvaluation,
    baseline_ltv: float,
) -> ProfileIncentiveEvaluation:
    """Hard-enforce that net LTV >= baseline. If not, return empty bundle."""
    if evaluation.net_ltv >= baseline_ltv:
        return evaluation

    return ProfileIncentiveEvaluation(
        profile_id=evaluation.profile_id,
        selected_incentives=[],
        gross_ltv=baseline_ltv,
        estimated_cost=0.0,
        net_ltv=baseline_ltv,
        reasoning=f"Bundle dropped: net LTV (${evaluation.net_ltv:.2f}) < baseline (${baseline_ltv:.2f}). No incentives assigned.",
    )


def _run_experiment_thread(experiment_id: str, catalog_version: str,
                           max_iterations: int = 50,
                           patience: int = 3):
    """Run experiment with convergence-based stopping per profile.

    For each profile, iterations continue until net_ltv has not improved
    for ``patience`` consecutive rounds, or ``max_iterations`` is hit
    (safety cap to avoid runaway costs).
    """
    state = _experiments.get(experiment_id)
    if not state:
        return

    try:
        catalog = load_catalog(catalog_version)
        if not catalog:
            raise ValueError(f"Catalog {catalog_version} not found")

        # Compute cost map from the incentives snapshot in this experiment
        incentives = state.available_incentives
        cost_map = get_incentive_cost_map(incentives)

        total_profiles = len(catalog.profiles)
        profiles_done = 0

        for profile in catalog.profiles:
            if state.cancelled:
                state.status = "cancelled"
                state.current_step = "Experiment cancelled by user."
                state.completed_at = datetime.utcnow()
                return

            best_eval = None
            no_improve_count = 0
            iteration = 0

            while no_improve_count < patience and iteration < max_iterations:
                if state.cancelled:
                    state.status = "cancelled"
                    state.current_step = "Experiment cancelled by user."
                    state.completed_at = datetime.utcnow()
                    return
                iteration += 1
                state.current_step = (
                    f"Evaluating {profile.profile_id} "
                    f"(iter {iteration}, checking for convergence: "
                    f"{no_improve_count}/{patience})..."
                )

                evaluation = evaluate_incentive_bundle(profile, incentives, cost_map)

                if best_eval is None or evaluation.net_ltv > best_eval.net_ltv:
                    best_eval = evaluation
                    no_improve_count = 0  # reset — we found a better result
                else:
                    no_improve_count += 1

                # Progress: fraction of profiles done + partial within current
                partial = min(no_improve_count / patience, 1.0)
                state.progress = int(
                    ((profiles_done + partial) / total_profiles) * 100
                )

            state.iterations_per_profile = iteration  # track actual count

            if best_eval:
                final = _enforce_baseline(best_eval, profile.ltv)

                pop = profile.population_count or 1
                original_portfolio_ltv = profile.portfolio_ltv or (profile.ltv * pop)
                new_gross_portfolio_ltv = final.gross_ltv * pop
                portfolio_cost = final.estimated_cost * pop
                new_net_portfolio_ltv = final.net_ltv * pop

                result = ExperimentResult(
                    profile_id=profile.profile_id,
                    selected_incentives=final.selected_incentives if final.selected_incentives else ["None"],
                    original_portfolio_ltv=original_portfolio_ltv,
                    new_gross_portfolio_ltv=new_gross_portfolio_ltv,
                    portfolio_cost=portfolio_cost,
                    new_net_portfolio_ltv=new_net_portfolio_ltv,
                    lift=new_net_portfolio_ltv - original_portfolio_ltv,
                    reasoning=final.reasoning,
                )
                state.results.append(result)

            profiles_done += 1

        state.status = "completed"
        state.progress = 100
        state.current_step = "Experiment completed."
        state.completed_at = datetime.utcnow()

    except Exception as e:
        state.status = "failed"
        state.error = str(e)
        state.current_step = "Experiment failed."
        state.completed_at = datetime.utcnow()

def start_experiment(catalog_version: str, *,
                     max_iterations: int = 50,
                     patience: int = 3,
                     incentive_set_version: str | None = None) -> str:
    # Load the incentive set (specific version or default)
    if incentive_set_version:
        inc_set = fs_load_incentive_set(incentive_set_version)
        if not inc_set:
            raise ValueError(f"Incentive set '{incentive_set_version}' not found")
    else:
        inc_set = load_or_seed_default()

    incentives_snapshot = [inc.model_dump() for inc in inc_set.incentives]

    experiment_id = str(uuid.uuid4())
    state = ExperimentState(
        experiment_id=experiment_id,
        catalog_version=catalog_version,
        incentive_set_version=inc_set.version,
        status="running",
        progress=0,
        current_step="Initializing...",
        iterations_per_profile=0,  # updated per-profile during run
        available_incentives=incentives_snapshot,
        started_at=datetime.utcnow()
    )
    _experiments[experiment_id] = state

    thread = threading.Thread(
        target=_run_experiment_thread,
        args=(experiment_id, catalog_version),
        kwargs={"max_iterations": max_iterations, "patience": patience},
    )
    thread.daemon = True
    thread.start()

    return experiment_id

def get_experiment_status(experiment_id: str) -> Optional[ExperimentState]:
    return _experiments.get(experiment_id)

def cancel_experiment(experiment_id: str) -> bool:
    """Request cancellation of a running experiment."""
    state = _experiments.get(experiment_id)
    if not state or state.status != "running":
        return False
    state.cancelled = True
    return True

# ---- Experiment persistence (Firestore) ----

def save_experiment(experiment_id: str) -> str | None:
    """Persist a completed experiment to Firestore. Returns experiment_id or None."""
    state = _experiments.get(experiment_id)
    if not state or state.status not in ("completed", "cancelled"):
        return None
    fs_save_experiment(state)
    return state.experiment_id

def delete_experiment(experiment_id: str) -> bool:
    """Remove experiment from memory and Firestore."""
    removed = _experiments.pop(experiment_id, None)
    fs_removed = fs_delete_experiment(experiment_id)
    return removed is not None or fs_removed


def list_experiments(catalog_version: str | None = None) -> list[dict]:
    """List saved experiments from Firestore, optionally filtered by catalog_version."""
    return fs_list_experiments(catalog_version)


def load_experiment(experiment_id: str) -> ExperimentState | None:
    """Load a saved experiment from Firestore."""
    return fs_load_experiment(experiment_id)
