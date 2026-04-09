"""Deal Memo PDF generator.

Produces a structured PDF report from a Monte Carlo optimization result,
suitable for investor presentations and deal diligence meetings.

Light theme, content-dense, with inline charts and visualizations.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

from fpdf import FPDF

from models.monte_carlo import MonteCarloOptimizationResult
from models.profile_catalog import ProfileCatalog
from models.incentive_set import IncentiveSet

# ---------------------------------------------------------------------------
# Color palette
# ---------------------------------------------------------------------------
BLACK = (20, 20, 20)
DARK = (50, 50, 50)
MID = (120, 120, 120)
LIGHT = (180, 180, 180)
RULE = (200, 200, 200)
BG_ALT = (245, 247, 246)
WHITE = (255, 255, 255)

GREEN = (0, 160, 70)
GREEN_LIGHT = (220, 245, 230)
BLUE = (0, 100, 200)
BLUE_LIGHT = (230, 240, 252)
RED = (200, 50, 50)
RED_LIGHT = (252, 235, 235)
AMBER = (180, 120, 0)

_FONTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "fonts")


def _fmt(val: float) -> str:
    return f"${val:,.0f}"


def _pct(val: float) -> str:
    return f"{val * 100:.0f}%"


class DealMemoPDF(FPDF):
    """Clean, content-dense PDF with Linex Terminal branding."""

    def __init__(self):
        super().__init__()
        self.set_margins(left=14, top=14, right=14)
        self.set_auto_page_break(auto=True, margin=14)
        self._register_fonts()

    def _register_fonts(self):
        self.add_font("Geist", "", os.path.join(_FONTS_DIR, "Geist-Regular.ttf"))
        self.add_font("Geist", "B", os.path.join(_FONTS_DIR, "Geist-Bold.ttf"))
        self.add_font("GeistMono", "", os.path.join(_FONTS_DIR, "GeistMono-Regular.ttf"))
        self.add_font("GeistMono", "B", os.path.join(_FONTS_DIR, "GeistMono-SemiBold.ttf"))

    def header(self):
        self.set_font("GeistMono", "B", 7)
        self.set_text_color(*MID)
        self.set_y(6)
        self.set_x(14)
        self.cell(80, 5, "LINEX TERMINAL", align="L")
        self.cell(0, 5, "DEAL MEMO", align="R")
        self.set_draw_color(*RULE)
        self.line(14, 12, 196, 12)
        self.set_y(14)

    def footer(self):
        self.set_y(-10)
        self.set_font("GeistMono", "", 6.5)
        self.set_text_color(*LIGHT)
        self.cell(0, 4, f"{self.page_no()}/{{nb}}", align="C")

    def section_title(self, title: str):
        self.ln(2)
        self.set_font("Geist", "B", 11)
        self.set_text_color(*BLACK)
        self.cell(0, 6, title, new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(*BLACK)
        self.line(self.l_margin, self.get_y(), self.l_margin + 30, self.get_y())
        self.ln(3)

    def subsection(self, title: str):
        self.set_font("GeistMono", "B", 7)
        self.set_text_color(*MID)
        self.cell(0, 5, title.upper(), new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def body_text(self, text: str):
        self.set_font("Geist", "", 8.5)
        self.set_text_color(*DARK)
        self.multi_cell(0, 4.2, text)
        self.ln(1)

    def kv_line(self, key: str, value: str, value_color=None):
        self.set_font("GeistMono", "", 7.5)
        self.set_text_color(*MID)
        kw = self.get_string_width(key + "  ") + 2
        self.cell(kw, 4, key)
        self.set_font("GeistMono", "B", 7.5)
        self.set_text_color(*(value_color or BLACK))
        self.cell(0, 4, value, new_x="LMARGIN", new_y="NEXT")

    def table_header(self, cols: list[tuple[str, int]]):
        self.set_font("GeistMono", "B", 6.5)
        self.set_text_color(*MID)
        self.set_draw_color(*RULE)
        for i, (label, width) in enumerate(cols):
            align = "L" if i == 0 else "R"
            self.cell(width, 5, label.upper(), align=align)
        self.ln()
        self.line(self.l_margin, self.get_y(), self.l_margin + sum(w for _, w in cols), self.get_y())
        self.ln(0.5)

    def table_row(self, cols: list[tuple[str, int]], alt: bool = False, bold: bool = False):
        if alt:
            self.set_fill_color(*BG_ALT)
            y = self.get_y()
            total_w = sum(w for _, w in cols)
            self.rect(self.l_margin, y, total_w, 5.5, "F")
        self.set_font("GeistMono", "B" if bold else "", 7.5)
        self.set_text_color(*BLACK)
        for i, (value, width) in enumerate(cols):
            align = "L" if i == 0 else "R"
            self.cell(width, 5.5, value, align=align)
        self.ln()

    def h_bar(self, x: float, y: float, value: float, max_value: float,
              width: float = 50, height: float = 4, color=None):
        if max_value <= 0:
            return
        bar_w = max(1, (value / max_value) * width)
        self.set_fill_color(*(color or GREEN))
        self.rect(x, y, bar_w, height, "F")

    def warning_box(self, text: str):
        self.set_fill_color(*RED_LIGHT)
        y = self.get_y()
        self.set_font("Geist", "", 7.5)
        lines = self.multi_cell(self.epw - 8, 3.8, text, dry_run=True, output="LINES")
        h = max(7, len(lines) * 3.8 + 4)
        self.rect(self.l_margin, y, self.epw, h, "F")
        self.set_draw_color(*RED)
        self.line(self.l_margin, y, self.l_margin, y + h)
        self.set_xy(self.l_margin + 4, y + 2)
        self.set_text_color(*RED)
        self.multi_cell(self.epw - 8, 3.8, text)
        self.set_y(y + h + 2)

    def ci_bar(self, p5: float, p50: float, p95: float, x: float, y: float, width: float = 55):
        if p95 == p5:
            return
        def map_x(val):
            return x + (val - p5) / (p95 - p5) * width
        # Track (full width background)
        self.set_fill_color(*BG_ALT)
        self.rect(x, y, width, 3, "F")
        # Range fill (p5 to p95 only)
        range_x = map_x(p5)
        range_w = map_x(p95) - range_x
        self.set_fill_color(*GREEN_LIGHT)
        self.rect(range_x, y, max(1, range_w), 3, "F")
        # Median tick
        self.set_fill_color(*GREEN)
        mx = map_x(p50)
        self.rect(mx - 0.3, y - 0.3, 0.6, 3.6, "F")


def generate_deal_memo(
    result: MonteCarloOptimizationResult,
    catalog: ProfileCatalog,
    incentive_set: IncentiveSet,
) -> bytes:
    """Generate a Deal Memo PDF from MC optimization results."""
    pdf = DealMemoPDF()
    pdf.alias_nb_pages()
    pdf.set_title("Linex Terminal Deal Memo")
    pdf.set_author("Linex Terminal")

    total_lift = result.total_lift
    total_orig = result.total_original_ltv
    total_net = result.total_new_net_ltv
    total_cost = result.total_cost
    lift_pct = (total_lift / total_orig * 100) if total_orig > 0 else 0
    roi = (total_lift / total_cost) if total_cost > 0 else 0
    analysis_date = result.completed_at.strftime("%Y-%m-%d") if result.completed_at else "N/A"

    # ===================================================================
    # PAGE 1: Executive Summary + Segment Breakdown
    # ===================================================================
    pdf.add_page()
    pdf.section_title("1. Executive Summary")

    # Key metrics in a compact grid (2 rows x 4 cols)
    metrics = [
        ("Portfolio Lift", _fmt(total_lift), GREEN),
        ("Lift %", f"{lift_pct:.1f}%", GREEN),
        ("Net LTV", _fmt(total_net), BLACK),
        ("ROI", f"{roi:.1f}x", BLUE if roi >= 1 else RED),
        ("Original LTV", _fmt(total_orig), DARK),
        ("Incentive Cost", _fmt(total_cost), DARK),
        ("Profiles", str(len(result.profiles)), DARK),
        ("Population", f"{catalog.total_learning_population:,}", DARK),
    ]
    start_y = pdf.get_y()
    col_w = pdf.epw / 4
    for idx, (label, value, color) in enumerate(metrics):
        row = idx // 4
        col = idx % 4
        x = pdf.l_margin + col * col_w
        y = start_y + row * 14
        pdf.set_xy(x, y)
        pdf.set_font("GeistMono", "", 6)
        pdf.set_text_color(*MID)
        pdf.cell(col_w, 3.5, label.upper(), align="L")
        pdf.set_xy(x, y + 3.5)
        pdf.set_font("GeistMono", "B", 10)
        pdf.set_text_color(*color)
        pdf.cell(col_w, 6, value, align="L")
    pdf.set_y(start_y + 30)

    # Metadata
    pdf.set_font("GeistMono", "", 6.5)
    pdf.set_text_color(*LIGHT)
    pdf.cell(0, 3.5, f"{analysis_date}  |  {result.catalog_version}  |  {result.incentive_set_version}  |  {result.n_simulations:,} MC draws/bundle", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    # Warnings
    if result.warnings:
        for w in result.warnings:
            pdf.warning_box(w)

    # LTV waterfall bar chart: Original -> Cost -> Net
    pdf.subsection("LTV Waterfall")
    chart_x = pdf.l_margin
    chart_y = pdf.get_y()
    chart_w = pdf.epw
    bar_h = 8
    max_val = max(total_orig, total_net, total_cost) if max(total_orig, total_net, total_cost) > 0 else 1
    scale = (chart_w * 0.7) / max_val

    labels_values = [
        ("Original LTV", total_orig, BG_ALT, DARK),
        ("+ Lift", total_lift, GREEN_LIGHT, GREEN),
        ("- Cost", total_cost, RED_LIGHT, RED),
        ("Net LTV", total_net, BLUE_LIGHT, BLUE),
    ]
    for i, (label, val, bar_color, text_color) in enumerate(labels_values):
        y = chart_y + i * (bar_h + 2)
        # Label
        pdf.set_font("GeistMono", "", 6.5)
        pdf.set_text_color(*MID)
        pdf.set_xy(chart_x, y + 1)
        pdf.cell(28, bar_h - 2, label, align="L")
        # Bar
        bar_x = chart_x + 28
        bar_w = max(2, val * scale)
        pdf.set_fill_color(*bar_color)
        pdf.rect(bar_x, y, bar_w, bar_h, "F")
        # Value on bar
        pdf.set_font("GeistMono", "B", 7)
        pdf.set_text_color(*text_color)
        pdf.set_xy(bar_x + 2, y + 1)
        pdf.cell(bar_w, bar_h - 2, _fmt(val), align="L")

    pdf.set_y(chart_y + len(labels_values) * (bar_h + 2) + 3)

    # ===================================================================
    # Segment Breakdown (same page if room, otherwise new page)
    # ===================================================================
    if pdf.get_y() > 200:
        pdf.add_page()
    pdf.section_title("2. Segment Breakdown")

    # Table with inline population bar
    seg_cols = [
        ("Profile", 16), ("Pop.", 18), ("Share", 14),
        ("Base LTV", 24), ("Portf. LTV", 28), ("", 50), ("Description", 32),
    ]
    # Header
    pdf.set_font("GeistMono", "B", 6.5)
    pdf.set_text_color(*MID)
    pdf.set_draw_color(*RULE)
    col_labels = ["PROFILE", "POP.", "SHARE", "BASE LTV", "PORTF. LTV", "LTV DISTRIBUTION", "DESCRIPTION"]
    widths = [c[1] for c in seg_cols]
    for i, (label, w) in enumerate(zip(col_labels, widths)):
        align = "L" if i in (0, 5, 6) else "R"
        pdf.cell(w, 5, label, align=align)
    pdf.ln()
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.l_margin + sum(widths), pdf.get_y())
    pdf.ln(0.5)

    max_ltv = max((p.portfolio_ltv for p in catalog.profiles), default=1) or 1

    for i, profile in enumerate(catalog.profiles):
        if i % 2 == 1:
            pdf.set_fill_color(*BG_ALT)
            pdf.rect(pdf.l_margin, pdf.get_y(), sum(widths), 5.5, "F")

        pdf.set_font("GeistMono", "", 7)
        pdf.set_text_color(*BLACK)
        row_y = pdf.get_y()

        pdf.cell(16, 5.5, profile.profile_id, align="L")
        pdf.cell(18, 5.5, f"{profile.population_count:,}", align="R")
        pdf.cell(14, 5.5, _pct(profile.population_share), align="R")
        pdf.cell(24, 5.5, _fmt(profile.ltv), align="R")
        pdf.cell(28, 5.5, _fmt(profile.portfolio_ltv), align="R")

        # Inline LTV bar
        bar_x = pdf.get_x() + 2
        pdf.h_bar(bar_x, row_y + 1, profile.portfolio_ltv, max_ltv, width=46, height=3.5, color=GREEN)
        pdf.cell(50, 5.5, "", align="L")

        # Truncated description (full text in footnotes)
        desc = profile.description or ""
        short = desc[:28] + "..." if len(desc) > 28 else desc
        pdf.set_font("Geist", "", 6.5)
        pdf.set_text_color(*MID)
        pdf.cell(32, 5.5, short, align="L")
        pdf.ln()

    # Bottom rule
    pdf.set_draw_color(*RULE)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.l_margin + sum(widths), pdf.get_y())
    pdf.ln(3)

    # Full descriptions
    has_long_desc = any(len(p.description or "") > 28 for p in catalog.profiles)
    if has_long_desc:
        pdf.set_font("GeistMono", "", 6)
        pdf.set_text_color(*LIGHT)
        for profile in catalog.profiles:
            if not profile.description or len(profile.description) <= 28:
                continue
            pdf.set_font("GeistMono", "B", 6)
            pdf.set_text_color(*MID)
            pdf.cell(8, 3.5, profile.profile_id)
            pdf.set_font("Geist", "", 6.5)
            pdf.set_text_color(*MID)
            pdf.multi_cell(0, 3.5, profile.description)
            pdf.ln(0.5)

    # ===================================================================
    # PAGE 2: Recommended Bundles (dense, with CI bars)
    # ===================================================================
    pdf.add_page()
    pdf.section_title("3. Recommended Incentive Bundles")

    # Summary table first
    bundle_cols = [("Profile", 14), ("Incentive", 44), ("Net LTV", 22), ("Lift", 22), ("Cost", 22), ("P(>0)", 14), ("90% CI", 44)]
    pdf.table_header(bundle_cols)

    for i, comp in enumerate(result.profiles):
        b = comp.best_bundle
        ci_lo, ci_hi = b.confidence_interval_90
        incentive_name = ", ".join(b.selected_incentives) if b.selected_incentives else "None"
        if len(incentive_name) > 38:
            incentive_name = incentive_name[:35] + "..."
        pdf.table_row([
            (b.profile_id, 14),
            (incentive_name, 44),
            (_fmt(b.expected_net_ltv), 22),
            (_fmt(b.expected_lift), 22),
            (_fmt(b.expected_cost), 22),
            (_pct(b.probability_positive_lift), 14),
            (f"[{_fmt(ci_lo)}, {_fmt(ci_hi)}]", 44),
        ], alt=(i % 2 == 1))

    pdf.ln(4)

    # Lift comparison chart
    pdf.subsection("Lift by Profile")
    chart_y = pdf.get_y()
    max_lift = max((c.best_bundle.expected_lift for c in result.profiles), default=1) or 1

    for i, comp in enumerate(result.profiles):
        b = comp.best_bundle
        y = chart_y + i * 7
        pdf.set_font("GeistMono", "", 6.5)
        pdf.set_text_color(*MID)
        pdf.set_xy(pdf.l_margin, y + 1)
        pdf.cell(10, 5, b.profile_id, align="L")

        bar_x = pdf.l_margin + 12
        bar_max_w = 80
        bar_w = max(1, (b.expected_lift / max_lift) * bar_max_w) if max_lift > 0 else 1
        pdf.set_fill_color(*GREEN)
        pdf.rect(bar_x, y + 0.5, bar_w, 5, "F")

        pdf.set_font("GeistMono", "B", 6.5)
        pdf.set_text_color(*DARK)
        pdf.set_xy(bar_x + bar_w + 2, y + 1)
        pdf.cell(30, 5, _fmt(b.expected_lift), align="L")

        # CI bar on the right side
        p = b.net_ltv_percentiles
        if p and p.get("p5") is not None and p.get("p95") is not None and p["p95"] != p["p5"]:
            ci_x = pdf.l_margin + 130
            pdf.ci_bar(p["p5"], p["p50"], p["p95"], ci_x, y + 1, 50)
            pdf.set_font("GeistMono", "", 5.5)
            pdf.set_text_color(*LIGHT)
            pdf.set_xy(ci_x, y + 4.5)
            pdf.cell(50, 3, f"{_fmt(p['p5'])} ... {_fmt(p['p95'])}", align="C")

    pdf.set_y(chart_y + len(result.profiles) * 7 + 4)

    # ===================================================================
    # Sensitivity Analysis (tornado chart)
    # ===================================================================
    if result.sensitivity_analysis:
        if pdf.get_y() > 200:
            pdf.add_page()
        pdf.section_title("4. Sensitivity Analysis")
        pdf.body_text("Impact of +/- 20% variation in key assumptions on total portfolio lift.")

        # Tornado chart
        sens = result.sensitivity_analysis
        max_abs = max((max(abs(s.low_delta), abs(s.high_delta)) for s in sens), default=1) or 1
        center_x = pdf.l_margin + 50 + 45  # center of tornado
        bar_half_w = 45  # max half-width of bar

        chart_y = pdf.get_y()
        # Center line
        pdf.set_draw_color(*RULE)
        pdf.line(center_x, chart_y, center_x, chart_y + len(sens) * 10 + 2)

        for i, s in enumerate(sens):
            y = chart_y + i * 10
            # Label
            pdf.set_font("GeistMono", "", 7)
            pdf.set_text_color(*DARK)
            pdf.set_xy(pdf.l_margin, y + 2)
            pdf.cell(50, 5, s.param_name, align="R")

            # Low bar (left of center)
            low_w = (abs(s.low_delta) / max_abs) * bar_half_w if max_abs > 0 else 0
            pdf.set_fill_color(*RED_LIGHT)
            pdf.rect(center_x - low_w, y + 1, low_w, 7, "F")
            pdf.set_font("GeistMono", "", 5.5)
            pdf.set_text_color(*RED)
            pdf.set_xy(center_x - low_w - 1, y + 2)
            pdf.cell(low_w, 5, _fmt(s.low_delta), align="L")

            # High bar (right of center)
            high_w = (abs(s.high_delta) / max_abs) * bar_half_w if max_abs > 0 else 0
            pdf.set_fill_color(*GREEN_LIGHT)
            pdf.rect(center_x, y + 1, high_w, 7, "F")
            pdf.set_font("GeistMono", "", 5.5)
            pdf.set_text_color(*GREEN)
            pdf.set_xy(center_x + high_w + 1, y + 2)
            pdf.cell(30, 5, f"+{_fmt(s.high_delta)}" if s.high_delta >= 0 else _fmt(s.high_delta), align="L")

        # Axis labels
        pdf.set_y(chart_y + len(sens) * 10 + 3)
        pdf.set_font("GeistMono", "", 5.5)
        pdf.set_text_color(*LIGHT)
        pdf.set_x(pdf.l_margin + 50)
        pdf.cell(45, 3, "-20%", align="L")
        pdf.cell(0, 3, "+20%", align="L")
        pdf.ln(2)

        # Also include the data table for precision
        pdf.ln(2)
        sens_cols = [("Parameter", 40), ("Base", 26), ("-20%", 30), ("+20%", 30), ("Range", 30)]
        pdf.table_header(sens_cols)
        for i, s in enumerate(sens):
            range_val = abs(s.high_delta - s.low_delta)
            pdf.table_row([
                (s.param_name, 40),
                (_fmt(s.base_value), 26),
                (_fmt(s.low_delta), 30),
                (f"+{_fmt(s.high_delta)}" if s.high_delta >= 0 else _fmt(s.high_delta), 30),
                (_fmt(range_val), 30),
            ], alt=(i % 2 == 1))

    # ===================================================================
    # Methodology (compact)
    # ===================================================================
    if pdf.get_y() > 220:
        pdf.add_page()
    else:
        pdf.ln(4)
    pdf.section_title("5. Assumptions & Methodology")

    method_items = [
        ("Engine", "Monte Carlo simulation with Beta-Binomial conjugate priors."),
        ("Uptake", f"Beta-distributed uptake per incentive. Bayesian posterior updates from observed data where available."),
        ("Simulation", f"{result.n_simulations:,} draws/bundle. Uptake sampled, marginal revenue = uptake x marginal LTV, net = revenue - cost."),
        ("Selection", "Highest median (p50) net LTV bundle, constrained: p5 >= 95% of baseline LTV."),
        ("Marginal LTV", "Heuristic based on spend intensity and incentive cost. Model assumption, not causal. Validate before deployment."),
    ]
    for label, text in method_items:
        pdf.set_font("GeistMono", "B", 6.5)
        pdf.set_text_color(*MID)
        pdf.cell(18, 4, label.upper())
        pdf.set_font("Geist", "", 7.5)
        pdf.set_text_color(*DARK)
        pdf.multi_cell(0, 4, text)
        pdf.ln(1)

    # ===================================================================
    # Appendix: Raw Percentiles
    # ===================================================================
    if pdf.get_y() > 230:
        pdf.add_page()
    else:
        pdf.ln(3)
    pdf.section_title("6. Appendix: Raw Percentiles")

    app_cols = [("Profile", 20), ("p5", 26), ("p25", 26), ("p50", 26), ("p75", 26), ("p95", 26)]
    pdf.table_header(app_cols)

    for i, comp in enumerate(result.profiles):
        p = comp.best_bundle.net_ltv_percentiles
        pdf.table_row([
            (comp.profile_id, 20),
            (_fmt(p["p5"]), 26),
            (_fmt(p["p25"]), 26),
            (_fmt(p["p50"]), 26),
            (_fmt(p["p75"]), 26),
            (_fmt(p["p95"]), 26),
        ], alt=(i % 2 == 1))

    return pdf.output()
