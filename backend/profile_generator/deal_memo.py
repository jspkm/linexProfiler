"""Deal Memo PDF generator.

Produces a structured PDF report from a Monte Carlo optimization result,
suitable for investor presentations and deal diligence meetings.
"""

from __future__ import annotations

from datetime import datetime

from fpdf import FPDF

from models.monte_carlo import MonteCarloOptimizationResult
from models.profile_catalog import ProfileCatalog
from models.incentive_set import IncentiveSet


def _ascii_safe(text: str) -> str:
    """Replace non-ASCII characters with safe alternatives for Helvetica font."""
    return text.encode("ascii", errors="replace").decode("ascii")


class DealMemoPDF(FPDF):
    """Custom PDF with Linex branding."""

    def header(self):
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(100, 100, 100)
        self.cell(0, 8, "LINEX TERMINAL  - DEAL MEMO", align="L")
        self.ln(4)
        self.set_draw_color(200, 200, 200)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(6)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")

    def section_title(self, title: str):
        self.set_font("Helvetica", "B", 13)
        self.set_text_color(0, 0, 0)
        self.ln(4)
        self.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(0, 170, 255)
        self.line(10, self.get_y(), 80, self.get_y())
        self.ln(4)

    def body_text(self, text: str):
        self.set_font("Helvetica", "", 10)
        self.set_text_color(40, 40, 40)
        self.multi_cell(0, 5, text)
        self.ln(2)

    def table_header(self, cols: list[tuple[str, int]]):
        self.set_font("Helvetica", "B", 9)
        self.set_fill_color(240, 240, 240)
        self.set_text_color(60, 60, 60)
        for label, width in cols:
            self.cell(width, 7, label, border=1, fill=True, align="C")
        self.ln()

    def table_row(self, cols: list[tuple[str, int]], bold: bool = False):
        self.set_font("Helvetica", "B" if bold else "", 9)
        self.set_text_color(30, 30, 30)
        for value, width in cols:
            self.cell(width, 6, value, border=1, align="R")
        self.ln()


def _fmt(val: float) -> str:
    return f"${val:,.0f}"


def _pct(val: float) -> str:
    return f"{val * 100:.0f}%"


def generate_deal_memo(
    result: MonteCarloOptimizationResult,
    catalog: ProfileCatalog,
    incentive_set: IncentiveSet,
) -> bytes:
    """Generate a Deal Memo PDF from MC optimization results."""
    pdf = DealMemoPDF()
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=20)

    # --- Page 1: Executive Summary ---
    pdf.add_page()
    pdf.section_title("1. Executive Summary")

    total_lift = result.total_lift
    total_orig = result.total_original_ltv
    lift_pct = (total_lift / total_orig * 100) if total_orig > 0 else 0

    pdf.body_text(
        f"Analysis Date: {result.completed_at.strftime('%Y-%m-%d') if result.completed_at else 'N/A'}\n"
        f"Catalog: {result.catalog_version}\n"
        f"Incentive Set: {result.incentive_set_version}\n"
        f"Simulation: {result.n_simulations:,} Monte Carlo draws per bundle\n"
        f"Profiles Analyzed: {len(result.profiles)}\n"
        f"Total Population: {catalog.total_learning_population:,} customers"
    )

    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(0, 100, 0)
    pdf.cell(0, 8, f"Projected Portfolio Lift: {_fmt(total_lift)} ({lift_pct:.1f}%)", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(40, 40, 40)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, f"Original Portfolio LTV: {_fmt(total_orig)}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, f"Projected Net LTV: {_fmt(result.total_new_net_ltv)}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, f"Total Incentive Cost: {_fmt(result.total_cost)}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    if result.warnings:
        pdf.set_font("Helvetica", "I", 9)
        pdf.set_text_color(180, 100, 0)
        for w in result.warnings:
            pdf.multi_cell(0, 5, f"Warning: {w}")
        pdf.ln(2)

    # --- Page 2: Segment Breakdown ---
    pdf.add_page()
    pdf.section_title("2. Segment Breakdown")

    cols = [("Profile", 25), ("Pop.", 20), ("Share", 18), ("Base LTV/user", 30), ("Portfolio LTV", 35), ("Description", 62)]
    pdf.table_header(cols)

    for profile in catalog.profiles:
        desc = _ascii_safe(profile.description[:30] + "..." if len(profile.description) > 30 else profile.description)
        pdf.table_row([
            (profile.profile_id, 25),
            (f"{profile.population_count:,}", 20),
            (_pct(profile.population_share), 18),
            (_fmt(profile.ltv), 30),
            (_fmt(profile.portfolio_ltv), 35),
            (desc, 62),
        ])

    # --- Page 3: Recommended Bundles ---
    pdf.add_page()
    pdf.section_title("3. Recommended Incentive Bundles")

    for comp in result.profiles:
        b = comp.best_bundle
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 7, f"Profile {b.profile_id}: {b.bundle_name}", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 9)

        incentive_list = _ascii_safe(", ".join(b.selected_incentives)) if b.selected_incentives else "No incentives"
        pdf.cell(0, 5, f"  Incentives: {incentive_list}", new_x="LMARGIN", new_y="NEXT")
        pdf.cell(0, 5, f"  Expected Net LTV: {_fmt(b.expected_net_ltv)}  |  Lift: {_fmt(b.expected_lift)}", new_x="LMARGIN", new_y="NEXT")
        pdf.cell(0, 5, f"  90% CI: [{_fmt(b.confidence_interval_90[0])}, {_fmt(b.confidence_interval_90[1])}]", new_x="LMARGIN", new_y="NEXT")
        pdf.cell(0, 5, f"  P(Lift > 0): {_pct(b.probability_positive_lift)}  |  Cost: {_fmt(b.expected_cost)}", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(3)

    # --- Page 4: Sensitivity Analysis ---
    if result.sensitivity_analysis:
        pdf.add_page()
        pdf.section_title("4. Sensitivity Analysis")

        pdf.body_text(
            "Shows how total portfolio lift changes when each key assumption "
            "varies +/- 20% from the base case."
        )

        sens_cols = [("Parameter", 45), ("Base Lift", 30), ("-20% Delta", 35), ("+20% Delta", 35), ("Range", 45)]
        pdf.table_header(sens_cols)

        for s in result.sensitivity_analysis:
            range_val = abs(s.high_delta - s.low_delta)
            pdf.table_row([
                (s.param_name, 45),
                (_fmt(s.base_value), 30),
                (_fmt(s.low_delta), 35),
                (f"+{_fmt(s.high_delta)}" if s.high_delta >= 0 else _fmt(s.high_delta), 35),
                (_fmt(range_val), 45),
            ])

    # --- Page 5: Assumptions & Methodology ---
    pdf.add_page()
    pdf.section_title("5. Assumptions & Methodology")

    pdf.body_text(
        "Optimization Engine: Monte Carlo simulation with Beta-Binomial conjugate priors.\n\n"
        "Uptake Modeling: Each incentive's uptake probability is modeled as a Beta distribution. "
        "Prior parameters are derived from the incentive's stated redemption rate and prior strength. "
        "Where observed data exists (pilot results), the posterior is updated via Bayesian conjugacy.\n\n"
        f"Simulation: {result.n_simulations:,} draws per profile per candidate bundle. "
        "For each draw, uptake rates are sampled independently for each incentive, "
        "marginal revenue is computed as uptake x estimated marginal LTV, and net LTV is "
        "marginal revenue minus incentive cost.\n\n"
        "Bundle Selection: The bundle with the highest median (p50) net LTV is selected, "
        "subject to the constraint that the 5th percentile net LTV is at least 95% of the "
        "baseline (no-incentive) LTV. This ensures probabilistic baseline enforcement.\n\n"
        "Marginal LTV Estimation: Uses a heuristic based on profile spend intensity and "
        "incentive cost. This is a model assumption, not a causal estimate. Validation "
        "against real program data is recommended before deployment decisions."
    )

    # --- Appendix ---
    pdf.add_page()
    pdf.section_title("6. Appendix  - Raw Percentiles")

    app_cols = [("Profile", 25), ("p5", 30), ("p25", 30), ("p50", 30), ("p75", 30), ("p95", 30)]
    pdf.table_header(app_cols)

    for comp in result.profiles:
        p = comp.best_bundle.net_ltv_percentiles
        pdf.table_row([
            (comp.profile_id, 25),
            (_fmt(p["p5"]), 30),
            (_fmt(p["p25"]), 30),
            (_fmt(p["p50"]), 30),
            (_fmt(p["p75"]), 30),
            (_fmt(p["p95"]), 30),
        ])

    return pdf.output()
