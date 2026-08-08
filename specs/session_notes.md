# CMA Spec — Session Notes

Project: Prescriptive specification for CMA residential projects
User: Scott (residential architect, Birmingham AL — CMA / Carlisle Moore)

## Brief (current, expanded)
Two parallel versions of a concise, prescriptive (non-CSI) spec, drawing on 11 reference PDFs in
the Intake folder. Document is to be:

1. Interactive HTML preview with a **toggle** between the two versions, plus an
   **Export RTF** button that downloads the currently-shown version as a .rtf
   for paste into AutoCAD MTEXT.
2. Two parallel static RTF files alongside, ready to drop into MTEXT.

Versions:
- **Plan-Set Sale** — CMA sells a set of plans; CMA does NOT perform construction
  administration. Heavy risk-transfer / CYA tone, license-of-use language, no submittal review.
- **CMA Process** — CMA is architect of record with full CA. Enforceable language,
  required submittals + timelines, milestone reviews, change-order protocol with architect.

Topics covered (parallel section list across both versions):
01 General Conditions & Scope of Drawings
02 Drawing Interpretation & Precedence
03 Site Documentation & Existing Conditions
04 Contractor Qualifications & Licensing
05 Submittals & Approvals (or "& Approval Timelines" in Process edition)
06 Material Standards & Substitutions
07 Workmanship Standards
08 Change Order Protocol / Field Modifications
09 Quality Assurance & Final Inspection
10 Code Compliance — Alabama Residential

Style: Tufte-inspired typographic system used in CMA's other web apps. Warnock Pro display +
Interstate Condensed body via Typekit kit ikf0hkb. Clean hierarchy, hairline rules, no
decoration, two-column body. Two letter pages per version is acceptable.

## Reference materials harvested
All 11 PDFs in /Specs/Intake/ read this round. Useful spec language harvested:
- Joyce / Windsor — full materials list (copper flashing/gutters, stainless / silicon-bronze
  fasteners), allowance language, ASTM/ACI structural references.
- Brooks & Falotico — drawing copyright; "do not scale, written dimensions govern"; notify
  architect of discrepancies.
- Murphy & Co — verify-before-order shop drawing pattern.
- Kelter — general notes & structural standards.
- Michael Imber (1354 Columbus) — site/utility coordination, code-compliance laundry list,
  hidden-condition clause, certificate-of-occupancy procedure (CA-context only).
- Nequette (10 Troon) — dimensioning conventions, blocking-for-millwork, owner outlet/finish
  walk after framing & before wall finishes (lifted into CMA Process §09).
- Moment Design — image-only sheet excerpt; no usable spec text. Confirmed.

## Deliverables (current)
- /Specs/CMA_Spec_Builder.html — TSC-con–style two-pane builder (form-edit left, click-to-edit
  preview right) with Edition toggle (Plan-Set Sale / CMA Process), Detail preset
  (Light / Standard / Comprehensive), per-item checkboxes, "+ Add" custom items,
  localStorage persistence, Export RTF (current state), and Print. Content scales from
  ~14 essential items at Light to ~60 tradesman-level items at Comprehensive.
- /Specs/CMA_Spec_PlanSetSale_{Light,Standard,Comprehensive}.rtf — static RTFs (3)
- /Specs/CMA_Spec_CMAProcess_{Light,Standard,Comprehensive}.rtf — static RTFs (3)
- /Specs/CMA_Prescriptive_Specification.html — original two-version interactive sheet (kept
  for reference / single-page printing)
- /Specs/CMA_Spec_PlanSetSale.rtf, CMA_Spec_CMAProcess.rtf — original Standard-equivalent RTFs

## Architecture (Builder)
- SPEC_DATA: factory-default content for each (version × section × item)
- state: { version, detail, project, ledeOverride, overrides, custom } in localStorage
- Detail preset uses LEVEL_RANK / ITEM_RANK to auto-include items at-or-below the chosen tier
- Per-item override flag `included` lets the user hand-tune around the preset
- lead/body overrides preserve user text edits across detail-preset changes
- "+ Add" appends user items into state.custom[version][sectionId]; always shown

## Verification (this session)
- Node smoke test (verify_builder.js): 6/6 RTF combos brace-balanced, well-formed,
  start with `{\rtf1`, end with `}`. Item counts: sale L/S/C = 14/29/60, process = 18/33/61.
- LibreOffice round-trip on Comprehensive Plan-Set Sale RTF: parses cleanly, recovers all
  expected expanded items (foundation 3000/4000 psi, framing SYP/SPF, WRB, copper 16-oz
  lock-seam, Manual J/D/S, 1/8″/8' & 1/4″/10' tolerances, owner outlet walk).

## Verification
- HTML rendered through WeasyPrint (fallback fonts) — clean two-page layout.
- RTFs round-tripped through LibreOffice; brace-balanced; clean text recovery.
- RTFs use a single Arial font, half-point sizes 22/26/32, bold/italic only — within
  AutoCAD MTEXT's RTF-paste capabilities.

## Change log
- 2026-05-06 — Rebuilt spec from single-version one-pager to two-version interactive HTML.
- 2026-05-06 — Added Plan-Set Sale edition with explicit "no CA / no submittal review /
  license-of-use / removing seal voids license" risk-transfer language.
- 2026-05-06 — CMA Process edition keeps enforceable AIA-aligned language with submittal
  timelines (10/5 working days), required milestone walks, post-finishes-before-paint outlet walk.
- 2026-05-06 — Added Alabama-specific licensing references: §34-14A Home Builders Licensure
  Board, Plumbers & Gas Fitters Examining Board, Electrical Contractors Board, HVAC Board.
- 2026-05-06 — RTF generation: HTML's Export RTF button writes simple RTF (Arial only,
  bold/italic, basic paragraph breaks) — AutoCAD MTEXT-compatible.
- 2026-05-06 — Static parallel RTFs generated with build_rtfs.py in /outputs.
