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

### D4 — `dir1/37_E` — rect-grid Yes/No matrix undetected (`checkboxes=0`); promoted grid logic into the skill
- **Symptom:** `37_E.pdf` (16-page BSCM Foods questionnaire) is a multi-section
  Yes/No/specify matrix drawn entirely as thin `rects`/`lines` — no checkbox
  squares and no AcroForm. `inspect_pdf.py` reported `checkboxes=0` on every page,
  so the answer-cell column centers + row y-bands had to be re-derived by hand
  (same as `10_E`). This is the **recurrence** the seeded defect #2 note warned
  about ("if the loop keeps re-deriving it per form, promote that logic").
- **Root cause:** `inspect_pdf.py` only emitted `blanks` + `checkboxes`; it had no
  notion of a ruled answer **grid**, so any rect-grid matrix produced nothing
  tickable.
- **Fix (skill):** added rect-grid **table detection** to `inspect_pdf.py`. It now
  reconstructs column edges (vertical lines/rects drawn ≥3× = one per row) and row
  borders (horizontal segments merged collinearly that span the table width), and
  emits a `tables` array per page: each table has `columns` (`x0/x1/cx` + detected
  `header` words, e.g. `ใช่ (Yes)` / `ไม่ใช่ (No)`) and `rows`
  (`top/bottom/cy_pdf/h/label_left`). On `37_E` this reproduces the hand-derived
  geometry exactly (allergen pages Yes cx=389.9 / No cx=430.2; quality+labor pages
  Yes cx=361.6 / No cx=425.4). Verified **additive**: `9_E` (stroked boxes) →
  `tables=0`, `11_E`/`19_E` still detect their checkboxes/AcroForm fields. So
  `dir2/dir3 37_E` (and the `10_E` family) now get tick geometry straight from
  inspect — pass row `cy_pdf` as the check `cy`, column `cx` as `cx`.

### Note on this form family (37_E = BSCM Foods "Procurement Questionnaire")
- `37_E.pdf` is a **16-page BSCM Foods CO., LTD. Procurement supplier
  questionnaire** (FM-PC-002/14(05)), **not** the Evershining scoring matrix.
  Page 595.32×841.92, no AcroForm, rect-grid (use the new `tables` output, D4).
  Sections: **Part 1 (allergen/contaminant)** = idx 0–3 (Yes `ใช่` cx=390 / No
  `ไม่ใช่` cx=430.2 / "If Yes specify"); **identity** idx 0 top box + idx 3
  Part-2 block (company/date/address/contact/tel/fax/email/product +
  manufacturer block); **General info + cert table** idx 4 (free text);
  **lab-params / external-labs / inspection-plan** idx 5–6 (free text);
  **quality matrices** idx 7–12 (building structure, raw material/process,
  release/storage, pest/glass/cleaning, chem/calibration/traceability,
  personnel/complaint/ethics — Yes cx=361.6 / No cx=425.4); **labor matrices**
  idx 13–15; **signature block** idx 15 bottom.
- **Coherent answer logic** (for a clean single-ingredient plant feed product):
  allergen/contaminant "does it CONTAIN X?" rows → tick **No**; the
  "5. suitable for vegetarian/vegan/Muslim?" and "6. free from beef/pork/lamb/
  chicken?" groups → tick **Yes**; all quality + labor capability/compliance
  rows → tick **Yes**; the one operational "raw materials contain allergen/GMO?"
  (idx 8) and "pest outbreak in last 6 months?" (idx 10) → **No**.
  **Skip** (leave blank): grey section-title bars, the repeated column-header row,
  pure choice rows ("self / external — specify"), pure explain/how/list rows
  ("อธิบาย…", storage-location □ list, personnel-hygiene □ PPE list), the
  free-text tables (idx 4–6), all "specify" columns, and the respondent/verifier
  signature block. Rows that START with `มี` (have/there-is) count as Yes even
  when they trail `…อย่างไร/กี่ครั้ง`.

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
- **dir2/11_E confirm (D2 auto-detect worked):** inspect found **100 Yes-boxes**
  on pages 1–13 (tick each at its `cx≈293.4`/`cy_pdf`) + the 14 cover certs. Of
  the 105 decimal-numbered rows, **5 carry no ☐ glyph**: 28.2/28.3/28.4 (page 14,
  Yes/No cells **white** → tick Yes once at row top, `cx=293.4`, `cy≈H-top-12`) and
  **18.2/18.3** (Yes/No/N/A cells **blacked out** by the form, describe-only → leave
  blank). So tick-rule = "every detected Yes-box + the 3 white describe rows on
  p14"; skip blacked describe rows. Matches the verified dir1 render exactly.

### Worklist note — work.json `src` paths are stale; resolve on disk
- **Symptom:** every `work.json` `src` is `…/01_แบบสอบถามยังไม่กรอก/<f>.pdf`, but on
  disk the dir2 (and dir3) blank-form folder is **`แบบสอบถามยังไม่กรอก` (no `01_`
  prefix)**, and macOS stores the Thai name **NFD-normalized** while string
  literals here are NFC. `os.path.exists`/`open` on the literal `src` fails
  (`FileNotFoundError`) even though `ls`/`pdfplumber` from a shell arg succeed.
- **What to do:** don't trust `work.json`/anchors `src` verbatim for `open()`.
  Resolve the real path on disk first, e.g.
  `glob.glob(f"{base}/*/<stem>.pdf")` (drop the `…กรอกแล้ว` output folder), or walk
  `os.listdir` comparing `unicodedata.normalize("NFC", entry)`. Pass that resolved
  absolute path as `src`/`out` in fills.json. Not a skill-script bug — a data/path
  quirk that will recur for **all remaining dir2/dir3 items**.

### D5 — `dir1/38_E` — single-answer-column form needs **centered** stamped text (overlay only left-aligned)
- **Symptom:** `38_E.pdf` (13-page PFI questionnaire) answers go in ONE column
  headed `ใช่ / ไม่ใช่ / NA` — the respondent writes the *word* `ใช่`/`ไม่ใช่`, not
  a tick in a per-option column. `overlay_fill.py` text items only `drawString`
  (left-anchored), so a word stamped at the column center spills right of center
  and reads as misaligned in narrow cells.
- **Root cause:** no horizontal-alignment option on `kind:"text"` items.
- **Fix (skill):** `overlay_fill.py` text branch now honors `"align"`:
  `"center"`→`drawCentredString`, `"right"`→`drawRightString`, default left.
  Pass `x` = cell center cx, `align:"center"` to drop an answer word dead-center
  in a single-answer grid column. Additive, font-independent. Benefits any future
  form with a write-the-answer column.

### Note on this form family (38_E = PFI "Supplier Questionnaire", F-CO-063)
- `38_E.pdf` is a **13-page PATTANI FOOD INDUSTRIES (PFI)** *Supplier
  Questionnaire* (F-CO-063 คร./issue 6), **landscape 841.92×595.32**, no AcroForm,
  rect-grid. Columns: `ข้อ` (no.) | `รายการตรวจสอบ` (item) | **`ใช่/ไม่ใช่/NA`
  (SINGLE answer column)** | `รายละเอียดเพิ่มเติม` (details). Page 0 = PFI
  letterhead + company-info block (ชื่อ/ที่อยู่/โทร/Email/ปีที่ก่อตั้ง/กำลังการ
  ผลิต/จำนวนคนงาน/ช่วงเวลาทำงาน/ชนิดของผลิตภัณฑ์) + cert checkboxes (stroked
  squares: HACCP cx94.7 / GMP cx146.7 / ISO9001 / ISO22000 / BRCGS / อื่นๆ, all
  cy≈279) then sections 1–14 spanning to p12.
- **Answer-column geometry (same template, but the page-0 grid is shifted ~21pt):**
  answer cx = **603.1 on page 0**, **582.1 on pages 1–12**. Don't trust one cx
  across pages — derive per page from the two vertical dividers bounding the 3rd
  column (p0 568.4/638.0; p1-12 547.6/616.7).
- **Reusable row classifier (no checkbox/AcroForm to read):** the answer *cells*
  are the bands between **horizontal dividers that cross the answer column** (thin
  `lines`/`rects` spanning the column center). Per cell:
  - **skip** the page-header band (`F-CO-063`), the `รายการตรวจสอบ` column-header
    row (also the only **grey-filled** band, nsc≈0.851), any `ส่วนที่ N`/`หมวดที่ N`
    section bar, **bold-font** sub-group headers (`AngsanaNew-Bold`: อาคารสถานที่,
    วัตถุดิบ, พื้น ผนัง…, การควบคุมสัตว์พาหะ, …), pure `โปรดระบุ` specify rows
    (5.25), blank rows, and the signature block (`ลงชื่อ`/`SUPPLIER`).
  - **gate** answers to cells *after* the `รายการตรวจสอบ` header row on each page
    (drops the page-0 company-info block, whose full-width rules also cross the
    answer column).
  - everything else (decimal `N.M`/`N.M.K` numbered questions, `-`/`–`/`−` bullet
    sub-items, and **regular-font** un-numbered follow-ups like `ถ้าใช่…`) → answer.
  - **WATCH:** matching the page header by the substring `หนา้` false-positives on
    `หน้างาน`/`หน้าต่าง`/`เจ้าหน้าที่` — match the header band by `F-CO-063` only.
- **Coherent answer logic (clean single-ingredient plant feed, e.g. corn):**
  every capability/compliance question + bullet → **ใช่**; allergen-presence
  section **8.9** and **8.9.1–8.9.9** (wheat/soy/egg/milk/peanut/fish/shellfish/
  nut/SO₂) → **ไม่ใช่** (corn carries none; leave the 3 trailing blank allergen
  rows empty); food-fraud-vulnerability section **14** → **ไม่ใช่** for the risk
  factors 14.1/2/3/5/6, **ใช่** only for 14.4 (bulk, low variable cost = true).
  Leave the `รายละเอียดเพิ่มเติม` details column + signature block blank.
- **dir2/dir3 38_E** are the same template — reuse this geometry + classifier; only
  vary the mock supplier/product so files don't look identical.

### D6 — `dir1/50_E` — `inspect_pdf.py` misses **curve-drawn** checkboxes (cert boxes)
- **Symptom:** `50_E.pdf` cover certs (ISO/GMP/HACCP/ISO สิ่งแวดล้อม/อื่นๆ) are
  rounded-square boxes drawn as `curves`, not stroked `rects` or `☐` glyphs, so
  the rect detector (seeded #2) and the glyph detector (D2) both found nothing —
  `checkboxes=0` on page 0.
- **Root cause:** the checkbox scan only looked at `p.rects` + `p.chars`; a box
  rendered as a rounded rectangle is a `curve` object with no rect/glyph at all.
- **Fix (skill):** `inspect_pdf.py` now also scans `p.curves` for near-square
  stroked boxes (8–26 × 8–22, ar 0.6–2.0), deduped against rect/glyph boxes.
  50_E p0 now reports the cert boxes (GMP cx=284.8, HACCP cx=471.8, cy≈532;
  ISO/อื่นๆ at cx≈60.5/284.8). Verified additive: 9_E/10_E/11_E/19_E/37_E/38_E
  checkbox+table counts unchanged. Concentric curve pairs may emit 2 entries per
  box — harmless (caller selects by cx).

### D7 — `dir1/50_E` — table rows had no header flag → callers re-derived grey skips
- **Symptom:** the scoring-matrix shades sub-group headers, section-title-ish
  bands and the column-header (`Evaluations`/`คะแนน/Point`/`2-1-0`) rows grey, but
  `inspect_pdf.py`'s `tables.rows` emitted every band undistinguished, so every
  caller had to recompute which rows are headers vs answer rows.
- **Fix (skill):** each `tables.rows[]` now carries `"grey": bool` — true when the
  band overlaps a wide greyish filled rect (RGB ~0.55–0.92, near-neutral). Skip
  grey rows when ticking. Additive field; existing callers unaffected.

### Note on this form family (50_E = Evershining "FM-PU-09" supplier scoring matrix)
- `50_E.pdf` IS the 6-page Evershining feed-ingredient scoring matrix task.md
  describes (the seeded #1–5 trial form). Page 595.28×841.89, no AcroForm.
  Page 0 = header block (Supplier Name / วันที่ Date / Type of Goods / Product
  name / Source of raw materials) + cert curve-boxes + section 1 start; sections
  1–8 run to page 5; page 5 also holds the scoring legend (`2/1/0 หมายถึง…`),
  `สรุปผลการประเมิน` summary (คะแนนเต็ม / คะแนนที่ได้) and the signature block.
- **Score columns** `คะแนน/Point` = `2 / 1 / 0`. Vertical edges 432.1 | **477.8**
  | **523.6** | 569.3 → **"2" col cx = 455.0** (tick this), "1" cx=500.7,
  "0" cx=546.5. Tick **"2"** on every answer row (positive score, per task.md).
- **Reusable row classifier** (`scripts/fill_scoring_matrix.py`, the promoted
  helper): an answer cell = a horizontal-border band crossed by an **internal**
  score divider (477.8 OR 523.6 — OR them: each has rendering gaps, e.g. 6.3.1 is
  missed by 477.8 but covered by 523.6). Do **NOT** gate on the outer edges
  432.1/569.3 — they run the full form height and would catch the page-0 header
  block and the **white** section-title bars (`1.`…`8.`, `เอกสาร…`). Then **skip**:
  grey bands (sub-group headers `1.1/1.2/1.2.1…`, the `2-1-0` header which is the
  darker grey 0.651), and any band whose left label contains a column-header word
  (`ประเมิน`/`ประเมนิ`/`Evaluatio`/`คะแนน`/`Point`). Yields **69 answer rows**
  (1.1.1…8.2) + GMP + HACCP = **71 ticks**.
- **Certs:** tick **GMP (cx=284.8)** + **HACCP (cx=471.8)** at cy≈532 (row 1).
  Leave ISO / ISO สิ่งแวดล้อม / อื่นๆ blank.
- **Header text** stamped on the dotted leaders just right of each label word
  (overlay, font:"thai"). Leave the scoring legend, summary score totals,
  comment and the signature block blank (auditor fills).
- **Helper:** `python3 scripts/fill_scoring_matrix.py SRC.pdf OUT_fills.json
  '{"supplier":…,"date":…,"goods":…,"product":…,"source":…}'` → writes a
  ready-to-stamp fills.json (out path = `<name>_Filled.pdf` beside src), then
  `overlay_fill.py`. **dir2/dir3 50_E** are the identical template — rerun the
  helper, vary only the mock supplier/product.

### D8 — web app ran a stale fork of the engine; resynced + added AcroForm geometry helper
- **Symptom:** the Next.js app (`src/lib/autofill/`) shelled out to its own
  `pyscripts/inspect_pdf.py` + `overlay_fill.py`, a copy frozen at the initial
  build (commit 9a4e33c). It predated every Ralph-loop fix — no glyph boxes (D2),
  no curve boxes (D6), no rect-grid `tables` (D4/D7), no text `align` (D5), no
  ValueError guards. So the app silently produced nothing tickable on the matrix
  forms (10/37/38/50_E) and nothing at all on the AcroForm form (19_E).
- **Root cause:** two divergent copies of the engine; only the skill's copy got
  the fixes. Classic drift.
- **Fix:** the app now runs the skill's `scripts/` directly (`python.ts`
  `SCRIPTS` → `.claude/skills/auto-fill-pdf/scripts`, overridable via
  `AUTOFILL_SCRIPTS_DIR`). Deleted `pyscripts/`. The TS pipeline now consumes
  `tables` (tick column `cx` / row `cy_pdf`, skip grey rows) and has a real
  AcroForm branch: flatten (`qpdf --flatten-annotations=all`) → overlay text on
  each field `/Rect` + ticks on the chosen radio kid by physical column → Thai
  via overlay, never pypdf (D3). Added a verify phase (pdftoppm render surfaced
  in the UI). One engine for both the skill and the app from here.
- **New skill script:** `scripts/acroform_fields.py` (used by the app's AcroForm
  branch, also handy inline) emits field geometry — text `/Rect` + radio kid
  columns with on-states, ordered left→right. Verified on 19_E: 319 fields
  (108 text/choice, 211 button groups); flatten+overlay tick lands inside the
  Yes circle (cx≈480.7 = left column) and Thai header text renders, no tofu.
