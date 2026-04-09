# Changelog

All notable changes to this project will be documented in this file.

## [0.1.2.0] - 2026-04-08

### Changed
- Redesigned Deal Memo PDF with Geist/GeistMono fonts, replacing Helvetica. New content-dense layout with metrics grid, LTV waterfall chart, per-profile lift bars with confidence interval visualization, tornado sensitivity chart, and alternating row shading.
- Removed ASCII-safe text encoding (Geist supports full Unicode natively).
- Budget constraint warning now reads more clearly: shows unconstrained cost and budget in one sentence.

### Fixed
- Frontend tables (catalog detail, optimization results) now scroll horizontally instead of clipping content.

## [0.1.1.0] - 2026-03-30

### Added
- What-if simulation fallback: agent chat now catches "what if uptake is 20%?" and "what if cost is $50?" even when Gemini fails to include the action JSON. Programmatic extraction with keyword matching, uptake clamping, and cost parsing.
- 19 new tests for what-if extraction covering uptake, cost, both, edge cases, and false positive prevention.

### Changed
- Switched fonts from IBM Plex Mono to Geist Sans (body/display), Geist Mono (data/labels), and JetBrains Mono (code) per DESIGN.md.
- Body font is now sans-serif (Geist) instead of monospace, improving readability for non-data content.
- DataroomCanvas data cells now use Geist Mono via CSS variable instead of generic monospace.

### Fixed
- Removed "assume"/"assuming" from what-if keyword triggers to prevent false positives in normal business language.
- Prevented double-dispatch when a message triggers both budget/target LTV and what-if extraction simultaneously.

## [0.1.0.0] - 2026-03-29

Initial tracked version. Monte Carlo optimization engine, agent chat, profile generator, deal memo export, and terminal UI.
