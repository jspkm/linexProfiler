import threading
import uuid
from typing import Any, Dict, List, Optional
from datetime import datetime
from pydantic import BaseModel
import json

from config import GEMINI_API_KEY, MODEL
from models.profile_catalog import ProfileCatalog, CanonicalProfile
from profile_generator.versioning import load_catalog
from google import genai
from google.genai import types

try:
    _gemini = genai.Client(api_key=GEMINI_API_KEY)
except Exception:
    _gemini = None

# Global in-memory state for experiments
_experiments: Dict[str, "ExperimentState"] = {}

# redemption_rate: fraction of users who actually redeem/use the benefit.
# Auto-applied rewards (cash back, points) ≈ 0.85-0.95
# Popular monthly credits ≈ 0.55-0.70
# Travel/niche perks ≈ 0.10-0.30
# Insurance/protection (claim-based) ≈ 0.03-0.10
# Fee waivers (automatic) ≈ 1.0
INCENTIVES = [
    {"name": "5x points for dining", "estimated_annual_cost_per_user": 45, "redemption_rate": 0.90},
    {"name": "2% flat cash back", "estimated_annual_cost_per_user": 60, "redemption_rate": 0.95},
    {"name": "$0 intro fee (Waived $95)", "estimated_annual_cost_per_user": 95, "redemption_rate": 1.0},
    {"name": "Double rewards on groceries", "estimated_annual_cost_per_user": 40, "redemption_rate": 0.90},
    {"name": "10x points on travel", "estimated_annual_cost_per_user": 120, "redemption_rate": 0.30},
    {"name": "0% APR for 15 months", "estimated_annual_cost_per_user": 80, "redemption_rate": 0.60},
    {"name": "$200 sign-up bonus", "estimated_annual_cost_per_user": 200, "redemption_rate": 0.85},
    {"name": "Complimentary Airport Lounge Access", "estimated_annual_cost_per_user": 150, "redemption_rate": 0.18},
    {"name": "$50 Annual Statement Credit for Streaming", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.65},
    {"name": "No Foreign Transaction Fees", "estimated_annual_cost_per_user": 25, "redemption_rate": 0.25},
    {"name": "Free primary rental car insurance", "estimated_annual_cost_per_user": 35, "redemption_rate": 0.12},
    {"name": "Elite Hotel Status Match", "estimated_annual_cost_per_user": 75, "redemption_rate": 0.10},
    {"name": "3x points on gas station purchases", "estimated_annual_cost_per_user": 30, "redemption_rate": 0.85},
    {"name": "Complimentary Global Entry/TSA PreCheck", "estimated_annual_cost_per_user": 20, "redemption_rate": 0.15},
    {"name": "$10 monthly Uber/Uber Eats credit", "estimated_annual_cost_per_user": 120, "redemption_rate": 0.60},
    {"name": "Preferred boarding on partner airlines", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.15},
    {"name": "6% cash back on select US streaming", "estimated_annual_cost_per_user": 45, "redemption_rate": 0.70},
    {"name": "3% cash back on online retail", "estimated_annual_cost_per_user": 55, "redemption_rate": 0.90},
    {"name": "Unlimited free delivery via DashPass", "estimated_annual_cost_per_user": 96, "redemption_rate": 0.40},
    {"name": "Purchase protection (up to $500/claim)", "estimated_annual_cost_per_user": 15, "redemption_rate": 0.05},
    {"name": "Extended warranty protection (+1 year)", "estimated_annual_cost_per_user": 10, "redemption_rate": 0.04},
    {"name": "4% cash back on gas and EV charging", "estimated_annual_cost_per_user": 40, "redemption_rate": 0.85},
    {"name": "$200 airline fee credit", "estimated_annual_cost_per_user": 200, "redemption_rate": 0.25},
    {"name": "Cell phone protection (up to $600)", "estimated_annual_cost_per_user": 25, "redemption_rate": 0.08},
    {"name": "3x points on drugstores", "estimated_annual_cost_per_user": 20, "redemption_rate": 0.75},
    {"name": "Complimentary first checked bag", "estimated_annual_cost_per_user": 60, "redemption_rate": 0.20},
    {"name": "Low intro APR on balance transfers", "estimated_annual_cost_per_user": 70, "redemption_rate": 0.35},
    {"name": "$100 hotel credit on luxury stays", "estimated_annual_cost_per_user": 100, "redemption_rate": 0.12},
    {"name": "5% cash back on rotating categories", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.55},
    {"name": "Identity theft protection services", "estimated_annual_cost_per_user": 12, "redemption_rate": 0.10},
    {"name": "$15 monthly dining credit", "estimated_annual_cost_per_user": 180, "redemption_rate": 0.65},
    {"name": "Airport concierge services discount", "estimated_annual_cost_per_user": 30, "redemption_rate": 0.05},
    {"name": "Double points on all foreign spend", "estimated_annual_cost_per_user": 45, "redemption_rate": 0.25},
    {"name": "$300 annual travel credit", "estimated_annual_cost_per_user": 300, "redemption_rate": 0.30},
    {"name": "5x points on flights booked via portal", "estimated_annual_cost_per_user": 70, "redemption_rate": 0.20},
    {"name": "10x points on hotels booked via portal", "estimated_annual_cost_per_user": 130, "redemption_rate": 0.15},
    {"name": "$20 monthly digital entertainment credit", "estimated_annual_cost_per_user": 240, "redemption_rate": 0.55},
    {"name": "Complimentary Boingo Wi-Fi access", "estimated_annual_cost_per_user": 15, "redemption_rate": 0.05},
    {"name": "$100 back for Global Entry application", "estimated_annual_cost_per_user": 20, "redemption_rate": 0.15},
    {"name": "Unlimited 1.5% cash back on all spend", "estimated_annual_cost_per_user": 45, "redemption_rate": 0.95},
    {"name": "3x points on office supply stores", "estimated_annual_cost_per_user": 40, "redemption_rate": 0.30},
    {"name": "25% redemption bonus on travel", "estimated_annual_cost_per_user": 85, "redemption_rate": 0.25},
    {"name": "Free credit score monitoring", "estimated_annual_cost_per_user": 5, "redemption_rate": 0.35},
    {"name": "$200 hotel statement credit", "estimated_annual_cost_per_user": 200, "redemption_rate": 0.15},
    {"name": "3x points on eco-friendly merchants", "estimated_annual_cost_per_user": 25, "redemption_rate": 0.20},
    {"name": "Complimentary ShopRunner membership", "estimated_annual_cost_per_user": 10, "redemption_rate": 0.15},
    {"name": "$50 back on fitness subscriptions", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.25},
    {"name": "Triple points on local transit/commute", "estimated_annual_cost_per_user": 35, "redemption_rate": 0.35},
    {"name": "No overlimit fees ever", "estimated_annual_cost_per_user": 8, "redemption_rate": 1.0},
    {"name": "$0 foreign transaction fee (premium)", "estimated_annual_cost_per_user": 30, "redemption_rate": 0.25},
    {"name": "2x points on entertainment and tickets", "estimated_annual_cost_per_user": 35, "redemption_rate": 0.50},
    {"name": "Complimentary roadside assistance", "estimated_annual_cost_per_user": 20, "redemption_rate": 0.06},
    {"name": "3x points on wholesale clubs", "estimated_annual_cost_per_user": 40, "redemption_rate": 0.45},
    {"name": "$100 anniversary travel voucher", "estimated_annual_cost_per_user": 100, "redemption_rate": 0.20},
    {"name": "5x points on prepaid rental cars", "estimated_annual_cost_per_user": 60, "redemption_rate": 0.10},
    {"name": "Airport lounge guest passes (2/yr)", "estimated_annual_cost_per_user": 60, "redemption_rate": 0.12},
    {"name": "$5 monthly coffee shop credit", "estimated_annual_cost_per_user": 60, "redemption_rate": 0.55},
    {"name": "Double points on utilities and bills", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.70},
    {"name": "3x points on department stores", "estimated_annual_cost_per_user": 35, "redemption_rate": 0.40},
    {"name": "Complimentary museum pass program", "estimated_annual_cost_per_user": 20, "redemption_rate": 0.08},
    {"name": "$40 annual credit for pet supplies", "estimated_annual_cost_per_user": 40, "redemption_rate": 0.20},
    {"name": "No late payment fees for first year", "estimated_annual_cost_per_user": 25, "redemption_rate": 1.0},
    {"name": "5x points on ride-sharing", "estimated_annual_cost_per_user": 55, "redemption_rate": 0.35},
    {"name": "$100 home improvement store credit", "estimated_annual_cost_per_user": 100, "redemption_rate": 0.15},
    {"name": "2x points on online subscriptions", "estimated_annual_cost_per_user": 30, "redemption_rate": 0.65},
    {"name": "Global Assist Hotline access", "estimated_annual_cost_per_user": 5, "redemption_rate": 0.03},
    {"name": "3x points on charitable donations", "estimated_annual_cost_per_user": 15, "redemption_rate": 0.15},
    {"name": "$25 statement credit for car rentals", "estimated_annual_cost_per_user": 25, "redemption_rate": 0.15},
    {"name": "Free annual night stay at partner hotel", "estimated_annual_cost_per_user": 250, "redemption_rate": 0.12},
    {"name": "5x points on cell phone services", "estimated_annual_cost_per_user": 65, "redemption_rate": 0.60},
    {"name": "Complimentary CLEAR membership", "estimated_annual_cost_per_user": 189, "redemption_rate": 0.08},
    {"name": "2x points on health and wellness", "estimated_annual_cost_per_user": 30, "redemption_rate": 0.35},
    {"name": "$100 Saks Fifth Avenue credit", "estimated_annual_cost_per_user": 100, "redemption_rate": 0.18},
    {"name": "Unlimited 2x points for first year", "estimated_annual_cost_per_user": 150, "redemption_rate": 0.85},
    {"name": "Trip delay reimbursement up to $500", "estimated_annual_cost_per_user": 15, "redemption_rate": 0.05},
    {"name": "Baggage delay insurance up to $100/day", "estimated_annual_cost_per_user": 10, "redemption_rate": 0.04},
    {"name": "$50 annual credit for florist/gifts", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.12},
    {"name": "Double points on insurance premiums", "estimated_annual_cost_per_user": 70, "redemption_rate": 0.30},
    {"name": "5x points on luxury brand purchases", "estimated_annual_cost_per_user": 120, "redemption_rate": 0.15},
    {"name": "Priority Pass Select membership", "estimated_annual_cost_per_user": 150, "redemption_rate": 0.15},
    {"name": "$100 annual credit for luxury spa", "estimated_annual_cost_per_user": 100, "redemption_rate": 0.10},
    {"name": "3x points on educational expenses", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.15},
    {"name": "Free shipping on all portal shopping", "estimated_annual_cost_per_user": 20, "redemption_rate": 0.40},
    {"name": "$30 annual statement credit for Wi-Fi", "estimated_annual_cost_per_user": 30, "redemption_rate": 0.35},
    {"name": "Return protection up to $300/item", "estimated_annual_cost_per_user": 15, "redemption_rate": 0.05},
    {"name": "Double points on home security spend", "estimated_annual_cost_per_user": 25, "redemption_rate": 0.15},
    {"name": "5x points on concerts and theaters", "estimated_annual_cost_per_user": 80, "redemption_rate": 0.20},
    {"name": "$150 annual statement credit for cruises", "estimated_annual_cost_per_user": 150, "redemption_rate": 0.08},
    {"name": "Unlimited 3% cash back on travel booked through us", "estimated_annual_cost_per_user": 90, "redemption_rate": 0.30},
    {"name": "2x points on hardware and DIY stores", "estimated_annual_cost_per_user": 35, "redemption_rate": 0.25},
    {"name": "$50 annual statement credit for pharmacy", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.40},
    {"name": "Double points on recurring memberships", "estimated_annual_cost_per_user": 40, "redemption_rate": 0.55},
    {"name": "5x points on electric vehicle charging", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.10},
    {"name": "Free entry to selected art galleries", "estimated_annual_cost_per_user": 15, "redemption_rate": 0.06},
    {"name": "$75 statement credit for baggage fees", "estimated_annual_cost_per_user": 75, "redemption_rate": 0.18},
    {"name": "6x points on selected supermarket spend", "estimated_annual_cost_per_user": 110, "redemption_rate": 0.80},
    {"name": "Unlimited 1% cash back on everything else", "estimated_annual_cost_per_user": 25, "redemption_rate": 0.95},
    {"name": "$100 statement credit for golf courses", "estimated_annual_cost_per_user": 100, "redemption_rate": 0.06},
    {"name": "Double points on all eco-transfers", "estimated_annual_cost_per_user": 30, "redemption_rate": 0.15},
    {"name": "5x points on furniture and decor", "estimated_annual_cost_per_user": 95, "redemption_rate": 0.15},
    {"name": "$50 annual credit for sustainable local business", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.12},
    {"name": "3x points on professional services", "estimated_annual_cost_per_user": 45, "redemption_rate": 0.20},
    {"name": "Complimentary premium airport transfers (1/yr)", "estimated_annual_cost_per_user": 100, "redemption_rate": 0.05},
    {"name": "Double points on pet insurance premiums", "estimated_annual_cost_per_user": 20, "redemption_rate": 0.12},
]

# Effective cost = annual_cost * redemption_rate (what the issuer actually pays)
_INCENTIVE_COST_MAP = {
    inc["name"]: round(inc["estimated_annual_cost_per_user"] * inc["redemption_rate"], 2)
    for inc in INCENTIVES
}


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
    status: str  # "running", "completed", "failed"
    progress: int  # 0 to 100
    current_step: str
    iterations_per_profile: int
    available_incentives: List[Dict[str, Any]]
    results: List[ExperimentResult] = []
    error: Optional[str] = None
    started_at: datetime
    completed_at: Optional[datetime] = None

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

def evaluate_incentive_bundle(profile: CanonicalProfile) -> ProfileIncentiveEvaluation:
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
        [f"- {inc['name']} (Effective Cost: ${round(inc['estimated_annual_cost_per_user'] * inc['redemption_rate'], 2)}/yr, redemption: {int(inc['redemption_rate']*100)}%)" for inc in INCENTIVES]
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

        cost = _INCENTIVE_COST_MAP.get(name, 0.0)

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

        total_profiles = len(catalog.profiles)
        profiles_done = 0

        for profile in catalog.profiles:
            best_eval = None
            no_improve_count = 0
            iteration = 0

            while no_improve_count < patience and iteration < max_iterations:
                iteration += 1
                state.current_step = (
                    f"Evaluating {profile.profile_id} "
                    f"(iter {iteration}, checking for convergence: "
                    f"{no_improve_count}/{patience})..."
                )

                evaluation = evaluate_incentive_bundle(profile)

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

                original_portfolio_ltv = profile.portfolio_ltv
                new_gross_portfolio_ltv = final.gross_ltv * profile.population_count
                portfolio_cost = final.estimated_cost * profile.population_count
                new_net_portfolio_ltv = final.net_ltv * profile.population_count

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
                     patience: int = 3) -> str:
    experiment_id = str(uuid.uuid4())
    state = ExperimentState(
        experiment_id=experiment_id,
        catalog_version=catalog_version,
        status="running",
        progress=0,
        current_step="Initializing...",
        iterations_per_profile=0,  # updated per-profile during run
        available_incentives=INCENTIVES,
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
