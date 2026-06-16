# auto-fill-pdf — reference

## Coordinate model

All coords are **PDF points, origin bottom-left** (reportlab native).
`inspect_pdf.py` already converts top-based pdfplumber values:

- blanks → `suggest_x`, `suggest_baseline` (baseline sits ~2pt above the rule).
- checkboxes → `cx`, `cy_pdf` (center). Pass `cy_pdf` as the item's `cy`;
  `overlay_fill.py` drops the mark to optical center via `cy - size*0.36`.

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
      "color": [0.05, 0.05, 0.55] },          // default ink-blue
    { "page": 0, "kind": "check",
      "cx": 70, "cy": 579, "size": 10,
      "mark": "✓", "font": "thai" }            // mark default "✓"
  ]
}
```

- `font` roles resolve to system TTFs: `thai`→Tahoma, `latin`→Arial (see
  `FONT_CANDIDATES` in `overlay_fill.py`). Unknown role → Helvetica.
- Multi-page: set `page` per item (0-based). Overlay merges page-for-page.
- `color` omitted → ink-blue `[0.05,0.05,0.55]`. Use `[0,0,0]` for black.

## Detection heuristics (inspect_pdf.py)

- **blanks** = horizontal `lines` (height<0.9, len>20) + thin filled `rects`
  (height<1.3, width>20). These are the write-on rules. `label_left` = words
  ending left of the rule on the same row.
- **checkboxes** = *stroked* rects, 6–22pt, near-square (|w−h|<6), deduped by
  rounded (x0,top). `label_right` = words just right of the box on its row.
- Tune thresholds in the script if a form uses unusual box sizes or dotted
  rules. Boxes drawn as fill+stroke pairs are deduped automatically.

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
Checkbox on-state name varies (`/Yes`, `/On`, …); read it from the field's
`/_States_` via `r.get_fields()`. Radio groups: tick by **physical column**, not
by export-name — read each kid widget's `/Rect` (`/Kids[*]` of the `/Btn`) and
pick the on-state whose box sits in the column you want (e.g. left = Yes). State
names are arbitrary and inconsistent across groups (`/Yes`,`/No`,`/0`,`/1`, and
sometimes reversed left↔right within the same form).

> **Thai / non-Latin AcroForm text → use the overlay path instead.** AcroForm
> text fields render with the form's built-in `/DA` font (usually Helvetica),
> which has no Thai glyphs. `update_page_form_field_values` sets `/V` correctly
> but the appearance is tofu/blank, and `NeedAppearances=True` doesn't help —
> poppler/pdftoppm just drops `U+0E..` ("couldn't find a font for character").
> For forms needing Thai, **don't** fill text via AcroForm: read each text
> field's `/Rect` (bottom-left = `x0,y0`) and stamp the value with `overlay_fill.py`
> (`x = x0+3`, `baseline = y0+~3`, `font:"thai"`) on the **original** PDF. Radios
> can still be ticked the same way — `kind:"check"` vector mark at each chosen
> kid's rect center — so the whole form goes through one overlay pass and renders
> font-independently. (See defects log D3, form family 19_E.)

## Failure modes

- **Thai renders as boxes** → chosen font lacks Thai. Pass a Sarabun/Tahoma
  path in `fonts.thai`.
- **Text floats above/below line** → adjust `baseline` (±2pt). Smaller form =
  smaller `size` (match nearby label size from inspect output).
- **Tick outside box** → use `cy_pdf` exactly; shrink `size` to box `size`−1.
- **Nothing detected** → form may be a flat scan (image). Needs OCR to locate
  fields; out of scope for now.

## Limitations (current scope)

- Single overlay pass, no reflow/wrapping — long values can overrun the rule.
  Shorten the mock or split across the next blank.
- Image-only/scanned PDFs unsupported (no vector anchors).
- Mock/sample data only.
