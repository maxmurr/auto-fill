# auto-fill-pdf — reference

## Coordinate model

All coords are **PDF points, origin bottom-left** (reportlab native).
`inspect_pdf.py` already converts top-based pdfplumber values:

- blanks → `suggest_x`, `suggest_baseline` (baseline sits ~2pt above the rule).
- checkboxes / table rows → `cx`, `cy_pdf` (cell center). For a `check` item pass
  `cy_pdf` as `cy` — or keep the key `cy_pdf`; `overlay_fill.py` accepts either.
  Set the check `size` ≈ the detected box `size`: the vector mark is vertically
  centered and bounded inside a `size`×`size` box at `(cx,cy)`, so a matching size
  lands the mark dead-center, inside the box. (The glyph fallback — any non-✓/x
  `mark` — instead baseline-corrects via `cy - size*0.36`.)

## fills.json schema

```jsonc
{
  "src": "path/to/in.pdf",          // required
  "out": "path/to/in_Filled.pdf",   // optional; default <src>_Filled.pdf
  "fonts": {                         // optional path overrides per role
    "thai": "/path/Sarabun.ttf",
    "thai-bold": "...", "latin": "...", "latin-bold": "..."
  },
  "items": [
    { "page": 0, "kind": "text",
      "x": 270, "baseline": 743,
      "text": "บริษัท ...", "font": "thai", "size": 8.5,
      "align": "left",                        // left(default) | center | right
      "color": [0.05, 0.05, 0.55] },          // default ink-blue
    { "page": 0, "kind": "check",
      "cx": 70, "cy": 579, "size": 10,        // cy OR cy_pdf; size ≈ box size
      "mark": "✓", "font": "thai" },          // "✓"/"tick" | "x" → vector mark
    { "page": 0, "kind": "check",
      "cx": 488, "cy_pdf": 300, "w": 34, "h": 12,
      "mark": "circle" }                      // stroked ellipse (w×h) around a target
  ]
}
```

- `font` roles resolve to system TTFs: `thai`→Tahoma, `latin`→Arial (see
  `FONT_CANDIDATES` in `overlay_fill.py`). Unknown role → Helvetica.
- Multi-page: set `page` per item (0-based). Overlay merges page-for-page.
- `color` omitted → ink-blue `[0.05,0.05,0.55]`. Use `[0,0,0]` for black.
- `text` `align`: `center`/`right` treat `x` as the cell center / right edge —
  e.g. drop an answer word (`ใช่`/`ไม่ใช่`) dead-center in a single-answer column.
- `check` `mark`: `"✓"`/`"check"`/`"tick"` or `"x"`/`"X"` → vector tick/cross,
  centered + bounded in the `size` box. `"circle"`/`"oval"` → stroked ellipse of
  `w`×`h` (default `size`); to **circle a word/option** instead of ticking a box,
  pass `cx,cy` = the word center and `w,h` = its bbox + a few pt padding. Any other
  `mark` is drawn as a font glyph (may tofu — avoid).
- Missing required keys (`text`: `x`/`baseline`/`text`; `check`: `cx` + `cy`/`cy_pdf`)
  or an unknown `kind` raise a `ValueError` naming the item — no silent bad stamp.

## Detection heuristics (inspect_pdf.py)

- **blanks** = horizontal `lines` (height<0.9, len>20) + thin filled `rects`
  (height<1.3, width>20). These are the write-on rules. `label_left` = words
  ending left of the rule on the same row.
- **checkboxes** = *stroked* rects, curve-drawn rounded boxes, and empty-box font
  glyphs (☐ □ ❑ ▢ …), 6–26pt, near-square, deduped by rounded (x0,top).
  `label_right` = words just right of the box on its row.
- **tables** = rect-grid matrices with no checkbox squares: column edges (verticals
  drawn ≥3×) + full-width horizontal borders → `columns` (x0/x1/cx + header word)
  and `rows` (top/bottom/cy_pdf/h/grey/label_left). Tick a cell at its column `cx`
  and row `cy_pdf`; skip `grey` rows (shaded headers/section bars).
- Tune thresholds in the script if a form uses unusual box sizes or dotted rules.

## AcroForm path (interactive form fields)

If `inspect_pdf.py` reports `acroform_fields` > 0, the PDF has real form
fields — fill them directly instead of overlaying:

```python
from pypdf import PdfReader, PdfWriter
r = PdfReader("in.pdf"); w = PdfWriter(); w.append(r)
for pg in w.pages:
    w.update_page_form_field_values(pg, {"FieldName": "value",
                                         "CheckboxField": "/Yes"})
with open("in_Filled.pdf","wb") as f: w.write(f)
```
> **Helper:** `python3 scripts/acroform_fields.py SRC.pdf [OUT.json]` dumps every
> field's geometry — text fields as `rect:[x0,y0,x1,y1]` (PDF bottom-left, stamp
> at `x0+3`/`y0+3`), button groups as `options[]` (each kid's `on_state` + center
> `cx,cy` + `w,h`, **sorted left→right by column**). Pick radios by `cx` (physical
> column), not `on_state`. Feeds straight into a flatten-then-overlay pass.

Checkbox on-state name varies (`/Yes`, `/On`, …); read it from the field's
`/_States_` via `r.get_fields()`. Radio groups: tick by **physical column**, not
by export-name — read each kid widget's `/Rect` (`/Kids[*]` of the `/Btn`) and
pick the on-state whose box sits in the column you want (e.g. left = Yes). State
names are arbitrary and inconsistent across groups (`/Yes`,`/No`,`/0`,`/1`, and
sometimes reversed left↔right within the same form).

> **Flatten annotations before overlaying an AcroForm.** A radio/checkbox widget's
> circle is its *appearance stream*, drawn ABOVE page content — so an overlay tick
> at the circle center gets painted over by the widget's own opaque circle, leaving
> only a tip poking out the top rim (the 19_E "ticks ride the top rim" bug; the
> widget `/Rect` center actually matches the printed circle to <0.3pt, so it was
> never an offset problem). Fix: flatten first, then inspect + overlay the flattened
> PDF — `qpdf --flatten-annotations=all in.pdf flat.pdf` (or in pypdf, drop each
> page's `/Annots`). The filled output is non-interactive, fine for a sample.

> **Thai / non-Latin AcroForm text → use the overlay path instead.** AcroForm
> text fields render with the form's built-in `/DA` font (usually Helvetica),
> which has no Thai glyphs. `update_page_form_field_values` sets `/V` correctly
> but the appearance is tofu/blank, and `NeedAppearances=True` doesn't help —
> poppler/pdftoppm just drops `U+0E..` ("couldn't find a font for character").
> For forms needing Thai, **don't** fill text via AcroForm: read each text
> field's `/Rect` (bottom-left = `x0,y0`) and stamp the value with `overlay_fill.py`
> (`x = x0+3`, `baseline = y0+~3`, `font:"thai"`) on the **flattened** PDF (flatten
> first — see the AcroForm note above — so widget appearances don't occlude the
> overlay). Radios are ticked the same way — `kind:"check"` vector mark at each
> chosen kid's rect center (= the printed-circle center) — so the whole form goes
> through one overlay pass and renders font-independently. (See defects log D3, 19_E.)

## Failure modes

- **Thai renders as boxes** → chosen font lacks Thai. Pass a Sarabun/Tahoma
  path in `fonts.thai`.
- **Text floats above/below line** → adjust `baseline` (±2pt). Smaller form =
  smaller `size` (match nearby label size from inspect output).
- **Tick outside / off-center** → set `size` ≈ the box `size` (the mark is bounded
  in that box). If a tick on an AcroForm shows only a tip at the top rim, a widget
  appearance is occluding it — flatten annotations first (see the AcroForm note).
- **Nothing detected** → form may be a flat scan (image). Needs OCR to locate
  fields; out of scope for now.

## Limitations (current scope)

- Single overlay pass, no reflow/wrapping — long values can overrun the rule.
  Shorten the mock or split across the next blank.
- Image-only/scanned PDFs unsupported (no vector anchors).
- Mock/sample data only.
