# auto-fill-pdf — known form families

Proven geometry + answer logic for the test forms (9/10/11/19/37/38/50_E). The
same template recurs across `data/ตัวอย่างข้อมูล{,' 2',' 3'}/` — only the mock data
differs. For a known form, take coords from here instead of re-deriving — but
**always render + verify once** after stamping (a form may have been revised).
Coords are PDF points, origin bottom-left (= inspect `cx` / `cy_pdf`).

> **Path quirk:** the blank-form dir is `แบบสอบถามยังไม่กรอก` (no `01_` prefix in
> dir 2/3) and macOS stores it NFD-normalized. Resolve real paths with
> `glob.glob(f"{base}/*/<stem>.pdf")`; don't `open()` an NFC literal.

> **Coherent mock = one clean single-ingredient plant feed** (corn / rice bran /
> soybean meal / cassava — vary per dir). Drives every "contains allergen / GMO /
> animal?" → No and every capability / compliance question → Yes.

## 9_E — Asian Alliance "Supplier Agreement" (1 pg)
Stroked-square checkboxes (inspect finds all 14). 7 clause rows: Accepted / ยอมรับ
(cx≈70) vs Unaccepted (cx≈182). **Tick left Accepted (cx≈70) on every clause row.**
Fill header text (Date / Supplier / Product / Manufacturing). Leave Acknowledge /
Approval / signature-Date blank.

## 10_E — MMP International C-TPAT security audit (2 pg)
Rect grid, `checkboxes=0` → use `tables`. Page 716.82×1014.51. Cols: criteria | S |
U | Comment, one tall S/U cell per section. S-col cx≈353.9. **Tick S once per
section = 12 ticks (6 p0 + 6 p1);** section 6 spills to p1 top — tick once on p0.
Header: Supplier Name / Products Supplied / Representative / Audit Date. Leave
Comment, "Inspection by", and Pass / Not-Pass result boxes blank.

## 11_E — SD Guthrie Morakot "Supplier Self Assessment" (16 pg)
Page 595.44×841.68. ☐-glyph boxes (inspect glyph detector finds them). Matrix cols:
No | Topic | Yes (cx≈293.3) | No (cx≈324.6) | N/A (cx≈358.4) | Details. **Tick Yes
on every decimal-numbered question `^\d+\.\d+$` (≈105 rows) at its glyph cy;** plain
integer rows are section headers → skip. Cover: tick GMP (cx≈45.6) + HACCP
(cx≈107.3) at cy≈513. Leave Total / Earned / %Score, grade legend, contacts,
signature and assessor block blank.
> **Tail page (confirmed at 300 dpi):** rows 28.2/28.3/28.4 have BLACKED-OUT
> Yes/No cells = "do not answer" → leave blank; 28.1 is white → tick Yes. (Earlier
> logs claimed 18.2/18.3 were blacked — they are not.) inspect finds ≈100 Yes-boxes
> total, which already excludes the blacked rows — tick every detected box.

## 19_E — FoodChain ID "Standard Ingredient Form" (5 pg, AcroForm, 319 fields)
Page 595.32×841.92. **Thai → overlay path, not pypdf text** (DA font tofus Thai).
Radios are printed circles: Yes LEFT (cx≈474–490), No RIGHT (cx≈504–521) — **tick
by physical column, not export-name** (radio_q11's names are reversed). **Flatten
annotations first** (`qpdf --flatten-annotations=all`, or drop `/Annots`) — the
Yes/No circles are radio-widget appearances that render above page content and
otherwise occlude the overlay tick (only a tip shows at the top rim — the old bug;
the rect center actually matches the circle). Overlay on the flattened PDF,
size≈10. Logic:
Q1 No, Q2 No, Q3 No, **Q4 Yes** (mono ingredient → the only left tick), Q5 No
(Tables 1/2 stay blank), Q6–Q13 No. Header text + Q4.1 crop/country on field rects
(Thai). Leave sub-radios, Q5 tables, `Check Box_1`, signature blank. p4 =
definitions (no fields).

## 37_E — BSCM Foods "Procurement Questionnaire" (16 pg)
Page 595.32×841.92, rect grid → use `tables`. **Column cx differs by section —
wrong cx = wrong column = wrong answer:** allergen pages Yes cx≈389.9 / No cx≈430.2;
quality + labor pages Yes cx≈361.6 / No cx≈425.4. Logic: "contains allergen / X?"
rows → No; vegetarian / halal / "free from meat" groups → Yes; all quality (idx
7–12) + labor (idx 13–15) capability rows → Yes, EXCEPT idx 8 raw-material allergen
/GMO → No and idx 10 pest-outbreak → No. Identity / free-text blocks → text. Skip
grey bars, repeated header rows, choice / "specify" / explain rows, signature.

## 38_E — PFI "Supplier Questionnaire" F-CO-063 (13 pg, LANDSCAPE 841.92×595.32)
Rect grid, single answer column headed `ใช่ / ไม่ใช่ / NA` — **the respondent WRITES
the word, not a tick.** Use `text` + `align:"center"` at the column center: cx≈603.1
on **page 0**, ≈582.1 on **pages 1–12** (grid shifts ~21pt — derive per page from
the two dividers bounding the 3rd column). p0: company-info block + cert stroked
squares (HACCP cx≈94.7 / GMP cx≈146.7 / …, cy≈279). Logic: capability / compliance
→ ใช่; allergen 8.9 + 8.9.1–8.9.9 → ไม่ใช่ (leave the 3 trailing allergen rows
blank); food-fraud §14 → ไม่ใช่ except 14.4 → ใช่. Skip: page-header band (match
`F-CO-063` only — **not** the substring `หนา้`), grey column-header row, ส่วนที่ /
หมวดที่ bars, bold sub-group headers, `โปรดระบุ` rows, details column, signature.

## 50_E — Evershining "FM-PU-09" scoring matrix (6 pg)
Page 595.28×841.89, rect grid. Score cols 2 / 1 / 0: "2" cx≈455.0, "1" 500.7, "0"
546.5. **Tick "2" on every answer row** (≈69 rows, 1.1.1…8.2). Answer row = a band
crossed by an INTERNAL score divider (477.8 OR 523.6 — OR them to fill rendering
gaps); do NOT gate on the outer edges 432.1/569.3 (they run full height and catch
the header block + title bars). Skip grey bands (sub-group headers, the 2-1-0
header) and column-header text rows. Certs: GMP (cx≈284.8) + HACCP (cx≈471.8) at
cy≈532 (curve boxes). Header text on the dotted leaders.
> Anchor the **Supplier Name** value after the *full* label / colon, not the word
> "Supplier" — anchoring on "Supplier" drops the value onto "Name" (a confirmed
> minor overlap). Leave legend / summary totals / signature blank.

Helper: `python3 scripts/fill_scoring_matrix.py SRC OUT '{"supplier":…,"date":…,"goods":…,"product":…,"source":…}'`
emits a ready-to-stamp `fills.json` (hardcoded 50_E geometry). The generic path for
any rect-grid matrix is inspect's `tables` output — prefer it for new forms.
