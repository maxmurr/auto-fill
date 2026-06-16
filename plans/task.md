# Task — auto-fill every blank questionnaire PDF (Ralph loop)

## Goal
Fill **every** blank supplier-audit questionnaire in the three input folders with
the `auto-fill-pdf` skill, and save each finished copy into a
`ตัวอย่างข้อมูลที่กรอกแล้ว/` folder created inside the **same base dir**.

This is a Ralph loop: each run does **ONE** PDF, records it, and stops. State
lives in the JSON PRD `plans/work.json` (each item `{id, base, src, out, passes,
mock, defect}` — `passes:false` until verified) plus `plans/defects.md`, not in
your memory.

## The forms
All PDFs are **feed-ingredient supplier audit questionnaires** — letterhead is
*Evershining Feed Ingredient* (เอฟเวอร์ไชน์นิ่ง อินเกรเดียน). They are 6-page
Thai/English **scoring matrices** (score columns `2 / 1 / 0`, and later sections
use `มี (Yes) / ไม่มี (No)`), plus a header block (Supplier Name, Date, Type of
Goods, Product name, Source of raw materials) and quality-cert checkboxes
(ISO / GMP / HACCP / ISO สิ่งแวดล้อม / อื่นๆ).

Use **realistic feed-ingredient mock data** (e.g. supplier "บริษัท ไทยฟีดมิลล์
จำกัด", product "ปลาป่น (Fish Meal)" / "กากถั่วเหลือง (Soybean Meal)" / "ข้าวโพด
บด (Corn)", source "ในประเทศ (Domestic)"). Vary values per file so they don't all
look identical. Score positively: tick column **"2"** (sections 1–5) / **"มี
(Yes)"** (sections 6–7) for each evaluation row. Tick **GMP + HACCP** for certs.
Leave the summary/score-total/comment/signature fields blank (an auditor fills
those). **Mock/sample data only — never present it as real.**

## Worklist
The full worklist is `plans/work.json` — 21 items across three base dirs, each
with `src` (blank PDF in `01_แบบสอบถามยังไม่กรอก/`) and `out` (target path in
`ตัวอย่างข้อมูลที่กรอกแล้ว/`, same base dir). It is the single source of truth;
do not re-derive the file list elsewhere.

## Per-iteration protocol (do ONE item only)
1. Pick the **first** item in `plans/work.json` with `"passes": false`
   (`jq -r '[.[]|select(.passes==false)][0]' plans/work.json`). That gives you
   its `src` and `out` paths.
2. Run the skill via the **Workflow** tool (this is the auto-fill-pdf workflow);
   pass the item's `src` as the pdf:
   ```
   Workflow({
     scriptPath: "<ABS_REPO>/.claude/skills/auto-fill-pdf/scripts/workflow.js",
     args: { pdf: "<ABS_BLANK_PDF>", skillDir: "<ABS_REPO>/.claude/skills/auto-fill-pdf", outDir: "/tmp" }
   })
   ```
   It stamps an overlay and writes `<name>_Filled.pdf` **beside the source**.
3. **Verify** the result: `pdftoppm -png -r 150 "<...>_Filled.pdf" /tmp/chk` then
   Read the page images. Confirm: header text sits on its dotted line (not over
   labels); checkmarks render as real ticks (not tofu boxes □); every tick is
   centered in the correct score column and on the correct row; grey
   section/sub-group headers, the `2/1/0` column header, section-title bars, and
   the Pass/Fail legend are **not** ticked; domain data is feed-ingredient
   coherent. The workflow may return `verified:false` — treat that as "not done".
4. If anything is off, **repair it** (rebuild `/tmp/auto_fill_fills.json` with
   corrected coords/data and re-run `overlay_fill.py`) until the render is
   correct. Re-verify.
5. **Skill improvement (REQUIRED when you hit a defect):** if the root cause is
   in the skill itself — a script bug, a bad detection heuristic, a glyph that
   won't render, wrong column/row logic, etc. — **fix the script** under
   `.claude/skills/auto-fill-pdf/` (`inspect_pdf.py`, `overlay_fill.py`,
   `workflow.js`, or `REFERENCE.md`) so the next form benefits, and **log it** in
   `plans/defects.md` (append: file, symptom, root cause, fix). Prefer fixing the
   skill over one-off patching whenever the defect would recur.
6. Move the finished PDF to the item's `out` path (mirrors source name, drops the
   `_Filled` suffix), creating the folder if needed:
   ```
   mkdir -p "$(dirname "<out>")"
   mv "<src dir>/<name>_Filled.pdf" "<out>"
   ```
7. Mark the item done in `plans/work.json`: set its `"passes": true` and fill
   `"mock"` (one-line summary of data used) and `"defect"` (ref to a
   `plans/defects.md` entry, or `"none"`). Edit **only that item**. Then **stop**
   (the loop relaunches you for the next one).

## Notes / constraints
- This directory is **not** a git repo → do **not** attempt commits.
- Use absolute paths; Thai filenames contain non-ASCII — quote every path.
- Deps already present: `pdfplumber reportlab pypdf`, `pdftoppm`, Thai fonts.
- Keep edits to the skill minimal and in the surrounding style.

## Completion
The loop stops on its own when **every** `work.json` item is `passes:true` AND
the deterministic gate `plans/check.sh` prints `CHECK_PASS` — you do not emit any
marker. So the only way to "finish" is real, verified files on disk.

If `check.sh` ever reports `MISSING` / `INVALID` / `TOO_SMALL` / `NO_OVERLAY` for
an item you set `passes:true`, you over-claimed: set that item back to
`passes:false`, fix it, and continue. Never set `passes:true` for a PDF you have
not rendered and visually verified.
