---
name: auto-fill-pdf
description: Fill a blank PDF form with realistic AI-suggested mock answers, stamped as an overlay on the original so the layout is untouched. Detects fill-rules, checkboxes (rect/curve/glyph), AcroForm fields and ruled answer grids; writes values in the field's Thai or English; ticks, crosses or circles the right options; then renders to verify alignment. Use when the user runs /auto-fill-pdf, asks to auto-fill / mock-fill / complete a PDF form, or points at a blank questionnaire / agreement / แบบสอบถาม PDF to fill in.
---

# auto-fill-pdf

Fill a blank PDF form with **mock** answers stamped as an overlay on the
**original** file — exact layout, no glyph reconstruction. Output:
`<name>_Filled.pdf` beside the source. Two scripts do the work:

- `scripts/inspect_pdf.py` — page geometry, AcroForm fields, blank fill-rules,
  checkboxes (rect / curve / glyph) and ruled answer **tables**, each with its
  nearby label. Writes `/tmp/<stem>.anchors.json` + a stdout summary.
- `scripts/overlay_fill.py` — stamps a `fills.json` (text + tick/cross/circle
  marks) onto the original, font-independent.
- `scripts/acroform_fields.py` — for interactive PDFs: emits each field's
  geometry (text `/Rect`; radio/checkbox kid columns with on-states, ordered
  left→right) so the flatten-then-overlay path needs no hand-derived coords.
  Writes `/tmp/<stem>.acro.json` + a stdout summary.

## Quick start

```bash
python3 scripts/inspect_pdf.py form.pdf        # → /tmp/form.anchors.json (+ summary)
pdftoppm -png -r 150 form.pdf /tmp/src         # eyeball layout (Read /tmp/src-1.png)
```
Build a `fills.json` from the anchors, then stamp + verify:
```jsonc
{ "src": "form.pdf", "items": [
  { "page":0, "kind":"text",  "x":270, "baseline":743, "text":"บริษัท ...", "font":"thai" },
  { "page":0, "kind":"check", "cx":70,  "cy_pdf":262,  "size":10, "mark":"✓" }
]}
```
```bash
python3 scripts/overlay_fill.py fills.json     # → form_Filled.pdf
pdftoppm -png -r 150 form_Filled.pdf /tmp/out  # Read /tmp/out-*.png to verify
```
Text `x`/`baseline` come from each blank's `suggest_x`/`suggest_baseline`; marks
use a checkbox/row `cx` + `cy_pdf` (pass it as `cy` or `cy_pdf`), `size` ≈ the box
size. Full schema + all mark options: [REFERENCE.md](REFERENCE.md).

## Workflow (inline — the reliable path)

1. **Resolve the target.** Arg after `/auto-fill-pdf` = path/glob → use it. No arg
   → search cwd for `*.pdf` (prefer "blank"/"ยังไม่กรอก" dirs), list, ask which.
   > macOS stores Thai filenames NFD-normalized — pass paths as shell args; don't
   > `open()` an NFC string literal (it `FileNotFoundError`s). Resolve via glob.
2. **Inspect.** Run `inspect_pdf.py`, read the anchors JSON, render a preview and
   look at it. If it's a known form, take geometry from [FORMS.md](FORMS.md).
3. **Decide answers.** Per fillable blank, pick a short realistic mock value in the
   field's language. Per checkbox/table row, pick the option a cooperative supplier
   would choose (FORMS.md has per-form answer logic). Mock data only.
4. **Assemble `fills.json`.** text on `suggest_x`/`suggest_baseline`; checks on
   `cx` + `cy_pdf`, `size` ≈ box size. Skip decorative rules, grey header bands,
   section bars, "specify"/explain columns and signature blocks.
5. **Stamp.** `overlay_fill.py fills.json` → `<name>_Filled.pdf`.
6. **Verify (+ repair).** Render at 150 dpi, Read every page: each value on its
   line, each mark inside its box. Nudge `baseline`/`cx`/`cy` and re-stamp if off.

## Rules
- `font` roles: `thai` / `thai-bold` for Thai, `latin` / `latin-bold` for ASCII.
- AcroForm with **Thai** text → don't fill via pypdf (the `/DA` font has no Thai
  glyphs → tofu). **Flatten annotations** (`qpdf --flatten-annotations=all`) so
  widget circles don't occlude the overlay, then stamp on each field's `/Rect`.
  Tick radios by **physical column**, not export-name. See REFERENCE.
- Single-answer "write the word" grids → `text` with `align:"center"` at the column
  center. Circle-the-word forms → `check` with `mark:"circle"`.
- Mock/sample data only — never present invented data as real.

## Optional: one-call Workflow

`scripts/workflow.js` runs the same pipeline as a multi-agent Workflow
(Inspect → Suggest → Assemble → Stamp → Verify). Use **only if the Workflow tool
binds `args` in your env** — in some sandboxes `args.pdf` arrives `undefined` and
the script dies instantly; fall back to the inline path above.
```
Workflow({ scriptPath: "<ABS_SKILL_DIR>/scripts/workflow.js",
           args: { pdf: "<ABS_PDF>", skillDir: "<ABS_SKILL_DIR>", outDir: "/tmp" } })
```

## Deps
`pip install pdfplumber reportlab pypdf` · `pdftoppm` (poppler) · a Thai font
(Tahoma / Sarabun / Arial Unicode; scripts auto-pick).
