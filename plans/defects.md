# Skill defect log — auto-fill-pdf

Append every defect found while filling forms + the fix applied to the skill.
Format: **symptom → root cause → fix (file)**. Newest at bottom.

---

## Seeded from the 50_E (dir 1) trial run — already fixed

These were found and fixed while filling `data/ตัวอย่างข้อมูล/01_…/50_E.pdf`
before the Ralph loop existed. Kept here so the loop knows the current state.

1. **Checkmarks rendered as tofu boxes (□), not ticks.**
   - Root cause: `overlay_fill.py` drew the `✓` (U+2713) glyph with the Thai
     font (Tahoma), which lacks/!subsets that glyph → `.notdef` box.
   - Fix: `overlay_fill.py` now draws checks as **vector strokes** (two lines for
     a tick, an X for crosses) centered on `(cx, cy)` — font-independent, always
     renders. Glyph path kept only for non-standard custom marks.

2. **This form type = scoring matrix, `inspect_pdf.py` reports `checkboxes=0`.**
   - Root cause: answer fields are dotted *text* and the grid is drawn as thin
     `rects` (no `line` objects) + rounded-square `curves` for cert boxes, so the
     geometric checkbox detector finds nothing. The generic workflow then
     improvises poorly (wrong column, row-bottom y, wrong-domain data).
   - Fix/approach (currently a per-form generator, see below): detect score rows
     from full-span horizontal gridline `rects`; tick the leftmost answer column
     derived from the **section header row** and propagate it down (per-band
     vertical dividers have rendering gaps); skip grey headers, the `2/1/0`
     header, section-title bars and the Pass/Fail legend.

3. **Header text stamped at far-left x≈20.9, overlapping labels.**
   - Root cause: detector anchored to gridline x, not the dotted answer line.
   - Fix: header values placed on the dotted-line x / baseline (mock data).

4. **Wrong-domain mock data ("stainless steel").**
   - Root cause: suggestion agent ignored the feed-ingredient letterhead.
   - Fix: use feed-ingredient mock data (see task.md).

5. **Indented grey sub-group headers (x0≈71) got ticked.**
   - Root cause: grey-bar filter required `x0<70`; sub-group bars are indented.
   - Fix: relaxed grey-bar detection to `x0<120 & x1>500`.

> NOTE: fixes (1) is in `overlay_fill.py`. The scoring-matrix row/column logic
> (2,3,5) currently lives in an ad-hoc generator built during the trial. If the
> loop keeps re-deriving it per form, **promote that logic into the skill**
> (`inspect_pdf.py` should emit score-table rows + answer-column centers; or add
> a documented helper) and log the promotion here.

---

## Loop-discovered defects
<!-- append below -->

### D1 — `dir1/9_E` — Workflow tool does not deliver the `args` global → workflow.js dies instantly
- **Symptom:** `Workflow({scriptPath: ".../workflow.js", args: {pdf, skillDir, outDir}})`
  fails at 3 ms, 0 agents, with `Error: undefined is not an object (evaluating
  'PDF.replace')`. Reproduced twice, identical. `args.pdf` comes back `undefined`,
  so `const filled = PDF.replace(...)` (workflow.js:18) throws before any phase.
- **Root cause:** in this environment the `args` value passed to the Workflow
  tool is **not bound** to the script's global `args` for `scriptPath`
  invocations. Workflow scripts run in a sandbox with **no fs / no env / no
  process access** (per the Workflow tool contract), so workflow.js *cannot*
  recover the PDF path by any other channel — there is no in-script fix.
- **Fix / what to do instead:** use the **inline path** that SKILL.md already
  documents under "Manual fallback (no Workflow)":
  `inspect_pdf.py <src>` → read `/tmp/<stem>.anchors.json` → write
  `/tmp/auto_fill_fills.json` (text items on `suggest_x`/`suggest_baseline`,
  check items on `cx`/`cy_pdf`) → `overlay_fill.py /tmp/auto_fill_fills.json` →
  `pdftoppm -r 200` + Read to verify. This is reliable and far cheaper than the
  agent fan-out. **Subsequent loop iterations should skip the Workflow call and
  go straight inline.** No skill *script* bug — detection + overlay both worked
  first try on this form.

### Note on this form family (9_E = Asian Alliance "Supplier Agreement")
- `9_E.pdf` is **not** the 6-page Evershining scoring matrix task.md describes —
  it is a **1-page Asian Alliance "Supplier Agreement"** with a header block
  (Date / Supplier info / Product Name / Manufacturing info) + 7 clause rows,
  each `Accepted / ยอมรับ` (left, cx≈70) vs `Unaccepted / ไม่ยอมรับ` (right,
  cx≈182), plus a bottom spec-number line and a signature box.
- `inspect_pdf.py` detects all 14 checkboxes correctly (stroked ~11pt squares).
  **Tick the left `Accepted` box (cx≈70) on every clause row**; leave the
  Supplier-Acknowledge / Approval / signature-Date lines blank (signatory fills).

### Note on this form family (10_E = MMP International "C-TPAT" security audit)
- `10_E.pdf` is a **2-page MMP International C-TPAT** supplier-security scoring
  matrix (FMMR-027 REV.A). Columns: criteria | **S** (Satisfactory, Score 1) |
  **U** (Unsatisfactory, Score 0) | Comment. `inspect_pdf.py` reports
  `checkboxes=0` — expected (rect grid, see seeded defect #2). Grid derived from
  vertical lines + full-width thin rects.
- **Reusable geometry (same on every 10_E across dirs):** page 716.82×1014.51.
  Column x-edges: 36.2 / 337.7 / **370.0** / 402.9 / 669.0 →
  **S-column cx = 353.9**, U cx ≈ 386.4. The S/U/Comment cells are **one tall
  cell per section** (no per-row dividers), so tick S **once per section**,
  centered in the section's y-band. 12 sections total = 12 S ticks
  (6 page0 + 6 page1). Section 6 (Seal) spills onto page1 top (band top
  21.8–64.0) — tick it once on page0 (band 817.9–930.3), leave the page1
  continuation cell blank.
- Section-band y-centers used (cy_pdf, H=1014.51): p0 784.9/658.4/531.8/406.9/
  276.3/140.4 ; p1 876.6/748.8/642.1/536.5/431.0/283.2.
- Header block (page0): Supplier Name (x≈108, baseline 920.5), Products Supplied
  (x≈421, baseline 920.5), Supplier Representative (x≈142, baseline 896.0),
  Audit Date (x≈392, baseline 896.0). Leave Comment column, `Inspection by___`,
  and the Pass / Not Pass result boxes blank (auditor fills). No skill bug.

### D2 — `dir1/11_E` — `inspect_pdf.py` misses **glyph** checkboxes (☐ U+2610) → `checkboxes=0`
- **Symptom:** `11_E.pdf` is full of empty-box checkboxes (cert row on the cover +
  a Yes/No/N/A box in every question cell), but `inspect_pdf.py` reported
  `checkboxes=0` on every page. The rect/curve detector found nothing because the
  boxes are **font glyphs** (☐ U+2610 in `MS-Gothic`), not stroked vector rects.
- **Root cause:** the checkbox detector only scanned `p.rects` for stroked
  near-square rectangles. Glyph-drawn boxes have no rect/curve object at all.
- **Fix (skill):** `inspect_pdf.py` now also scans `p.chars` for empty-box
  codepoints (☐ U+2610, □ U+25A1, ▢ U+25A2, ▫ U+25AB, …) and emits them into
  `checkboxes` with the same `cx`/`cy_pdf`/`size`/`label_right` schema, deduped
  against rect boxes. Re-running inspect on `11_E` now finds 14 cert boxes
  (page 0) + ~24 Yes/No/N/A boxes per matrix page (Yes col cx≈293.4).
  **dir2/dir3 `11_E` (same form) will auto-detect from now on.**

### D3 — `dir1/19_E` — AcroForm text fields can't render Thai (DA font lacks glyphs)
- **Symptom:** `19_E.pdf` is a real **AcroForm** (319 fields). Filling text via
  `update_page_form_field_values` set `/V` correctly but pypdf warned "characters
  not supported by font encoding", and rendering with `pdftoppm` printed
  `Syntax Error: HorizontalTextLayouter, couldn't find a font for character U+0E..`
  for every Thai glyph → Thai dropped entirely (only the Latin `(Rice Bran)` part
  showed). `NeedAppearances=True` did not help (poppler regen has no Thai font).
- **Root cause:** AcroForm text fields render with the form's built-in `/DA` font
  (Helvetica here), which has no Thai glyphs. REFERENCE.md's AcroForm path
  implied "fields > 0 → fill via pypdf" with no caveat for non-Latin text.
- **Fix (skill):** updated `REFERENCE.md` AcroForm section — for Thai/non-Latin
  forms, **skip AcroForm text fill** and instead read each text field's `/Rect`
  and stamp values with `overlay_fill.py` (`x=x0+3`, `baseline=y0+3`,
  `font:"thai"`) on the original PDF; tick radios as `kind:"check"` vector marks
  at the chosen kid's rect center — one overlay pass, font-independent. Also
  documented "tick radios by **physical column**, not export-name" (state names
  are arbitrary/inconsistent: `/Yes /No /0 /1`, sometimes reversed). **dir2/dir3
  19_E (same form) reuse the geometry below.**

### Note on this form family (19_E = FoodChain ID "Standard Ingredient Form")
- `19_E.pdf` is a **5-page FoodChain ID Standard Ingredient Form** (Non-GMO
  Project Standard, FC20230329), **AcroForm** w/ 319 fields. Page 595.32×841.92.
  p0 header + Q1–Q4; p1 = Q5 + Table 1/Table 2 (sub-ingredient/crop matrix);
  p2 = Q6–Q10; p3 = Q11–Q13 + signature block; p4 = definitions (no fields).
- **Radio Yes/No = physical column: Yes left, No right** (Yes cx≈474–490,
  No cx≈504–521). Export names vary per group and **radio_q11 is reversed**
  (`/0` is the RIGHT/No box, `/1` left/Yes) — always pick by rect x, not name.
- **Coherent mock = a simple non-GMO mono plant feed ingredient** (e.g. Rice
  Bran, domestic): Q1 No (not organic), Q2 No (not NGP-verified), Q3 No (not GM),
  **Q4 Yes (mono ingredient)**, Q5 No (not compound → Table 1/2 stay blank),
  Q6–Q10 No (no fermentation/microorganism/enzyme/synth-bio), Q11 No (not
  animal), Q12 No (not waterborne), Q13 No (it IS biological). Only Q4 ticks the
  left column; everything else No. Header text + Q4.1 crop source / country go on
  the field rects via overlay (Thai). Leave all sub-question radios, the Q5
  tables, `Check Box_1`, and the entire signature block (Signature/Print name/
  Position/Date Signed/Company Name) blank. No script bug — see D3 for the
  AcroForm-Thai fix.

### Note on this form family (11_E = SD Guthrie Morakot "Supplier Self Assessment")
- `11_E.pdf` is a **16-page SD Guthrie International Morakot** *Supplier Self
  Assessment Questionnaire* (PR-02-00-16 Rev.12). Page 595.44×841.68.
  Page 0 = cover (header block + cert-glyph row + Grade A/B/C/D legend).
  Pages 1–13 (render 2–14) = matrix; page 14 (render 15) = tail rows + a
  Total/Earned/%Score table; page 15 (render 16) = contacts + signature +
  assessor grade block.
- **Matrix columns** (rule x-edges): No 31.8–66.9 | Topic 66.9–281 |
  **Yes 281–312.2 (header word cx=293.3)** | No 312.2–343.9 (cx=324.6) |
  N/A 343.9–379.5 (cx=358.4) | Details 379.5+. Each answerable row has ☐ glyphs
  in Yes/No/N/A at the question's first-line y.
- **Approach used:** tick **Yes** (cx=293.3) on every decimal-numbered question
  (`^\d+\.\d+$`, 1.1 … 28.4 = **105 ticks**) at the No-column number token's
  y-center — coincides exactly with the form's ☐ glyph row, so ticks land dead-
  center in the Yes box. Plain-integer rows (1,2,3 …) are **section headers** with
  no answer cell → skip. Cover certs: tick **GMP (cx=45.6)** + **HACCP (cx=107.3)**
  at cy=513.2. Header fields placed on dotted leaders (baselines/dot-start x from
  `p.chars`). Leave Total/Earned/%Score, grade legend, contacts, signature and the
  assessor block blank. Now that D2 is fixed, dir2/dir3 11_E can read boxes from
  inspect directly instead of re-deriving geometry.
