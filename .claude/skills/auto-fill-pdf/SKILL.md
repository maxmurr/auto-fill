---
name: auto-fill-pdf
description: Pick a PDF form and fill it with AI-suggested realistic mock answers via a dynamic multi-agent workflow, stamped as an overlay on the original (layout untouched). Detects blank fill-rules and checkboxes, fans out agents to read each field's Thai/English label and propose plausible values, ticks the right boxes, then verifies alignment. Use when the user runs /auto-fill-pdf, asks to auto-fill / mock-fill / complete a PDF form, or points at a blank questionnaire/agreement/แบบสอบถาม PDF to fill in.
---

# auto-fill-pdf

Fill a blank PDF form with AI-suggested mock answers. Runs as a **Claude Code
dynamic workflow** (the Workflow tool) that orchestrates subagents:

```
Inspect → Suggest (fan-out: 1 agent per field) → Assemble → Stamp → Verify (+repair)
```

Answers are stamped as an overlay on the **original** file — exact layout, no
glyph reconstruction. Output: `<name>_Filled.pdf` beside the source.

## How to run it

1. **Resolve the target PDF.**
   - Arg after `/auto-fill-pdf` = path or glob → use it.
   - No arg → search cwd for `*.pdf` (prefer dirs hinting "blank"/"ยังไม่กรอก"),
     list candidates, ask the user which one.

2. **Trigger the workflow.** Call the **Workflow** tool with the bundled script
   (this is the dynamic orchestration step — do not inline it):
   ```
   Workflow({
     scriptPath: "<ABS_SKILL_DIR>/scripts/workflow.js",
     args: { pdf: "<ABS_PDF_PATH>", skillDir: "<ABS_SKILL_DIR>", outDir: "/tmp" }
   })
   ```
   `<ABS_SKILL_DIR>` = the absolute path to **this** skill folder
   (`.../.claude/skills/auto-fill-pdf`). Pass absolute paths.

   > Invoking `/auto-fill-pdf` is itself the opt-in for the Workflow tool — the
   > skill instructs the call, so no extra "ultracode" keyword is needed.

3. **Report.** The workflow returns `{output, fields_filled, boxes_ticked,
   verified, fills_json}`. Relay a short table of what was filled and the output
   path. If `verified` is false, open the rendered preview and fix remaining
   nudges manually (see REFERENCE).

## What the workflow does (scripts/workflow.js)

- **Inspect** — one agent runs `inspect_pdf.py`, renders a preview, returns page
  geometry + `blanks` (fillable vs decorative) + `checkboxes` (grouped by row).
- **Suggest** — `parallel()` fan-out: one agent per fillable blank reads its
  `label_left` and proposes a realistic mock value in the field's language; one
  agent picks one box per checkbox group.
- **Assemble** — JS builds `fills.json` from anchor coords + suggestions; an
  agent writes + validates it.
- **Stamp** — agent runs `overlay_fill.py` (merges overlay onto the original).
- **Verify** — agent renders the result, checks every value sits on its line and
  ticks are inside boxes; one repair round applies baseline deltas if off.

## Manual fallback (no Workflow)

If the Workflow tool is unavailable, run the same steps inline:
`inspect_pdf.py` → view preview → write `fills.json` (use `suggest_x`/
`suggest_baseline` + `cy_pdf` verbatim) → `overlay_fill.py` → render + verify.
Schema + heuristics: [REFERENCE.md](REFERENCE.md).

## Rules
- `font` roles: `thai` / `thai-bold` for Thai, `latin` / `latin-bold` for ASCII.
- AcroForm PDFs (inspect shows fields > 0): fill via pypdf — see REFERENCE.
- Mock/sample data only — never present invented data as real.

## Deps
`pip install pdfplumber reportlab pypdf` · `pdftoppm` (poppler) · a Thai font
(Tahoma/Sarabun/Arial Unicode; scripts auto-pick).
