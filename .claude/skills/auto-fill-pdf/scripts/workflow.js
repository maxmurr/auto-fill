export const meta = {
  name: 'auto-fill-pdf',
  description: 'Inspect a blank PDF form, fan out agents to suggest realistic mock answers per field, stamp them as an overlay on the original, then verify and repair alignment.',
  whenToUse: 'Invoked by the /auto-fill-pdf skill. args = { pdf, skillDir, outDir? }.',
  phases: [
    { title: 'Inspect', detail: 'run inspect_pdf.py, render source, return anchors' },
    { title: 'Suggest', detail: 'one agent per text field + one for checkbox groups' },
    { title: 'Assemble', detail: 'build fills.json from coords + suggestions' },
    { title: 'Stamp', detail: 'overlay_fill.py merges answers onto original' },
    { title: 'Verify', detail: 'render filled pdf, check alignment, repair if off' },
  ],
}

// ---- args ----
const PDF = args.pdf
const skillDir = args.skillDir
const outDir = (args && args.outDir) || '/tmp'
const filled = PDF.replace(/\.pdf$/i, '') + '_Filled.pdf'
const fillsPath = outDir + '/auto_fill_fills.json'
if (!PDF || !skillDir) throw new Error('args.pdf and args.skillDir required')

// ---- schemas ----
const INSPECT = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' },
    page: { type: 'object', additionalProperties: false,
      properties: { width: { type: 'number' }, height: { type: 'number' } },
      required: ['width', 'height'] },
    blanks: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: {
        id: { type: 'string' }, suggest_x: { type: 'number' },
        suggest_baseline: { type: 'number' }, label_left: { type: 'string' },
        decorative: { type: 'boolean' },
      }, required: ['id', 'suggest_x', 'suggest_baseline', 'label_left', 'decorative'] } },
    checkboxes: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: {
        id: { type: 'string' }, cx: { type: 'number' }, cy_pdf: { type: 'number' },
        label_right: { type: 'string' }, row: { type: 'number' }, size: { type: 'number' },
      }, required: ['id', 'cx', 'cy_pdf', 'label_right', 'row'] } },
  }, required: ['title', 'page', 'blanks', 'checkboxes'],
}
const VAL = { type: 'object', additionalProperties: false,
  properties: { id: { type: 'string' }, value: { type: 'string' },
    font: { type: 'string', enum: ['thai', 'thai-bold', 'latin', 'latin-bold'] } },
  required: ['id', 'value', 'font'] }
const CHECKS = { type: 'object', additionalProperties: false,
  properties: { chosen: { type: 'array', items: { type: 'object', additionalProperties: false,
    properties: { id: { type: 'string' }, cx: { type: 'number' }, cy: { type: 'number' },
      size: { type: 'number' }, reason: { type: 'string' } }, required: ['id', 'cx', 'cy'] } } },
  required: ['chosen'] }
const OK = { type: 'object', additionalProperties: false,
  properties: { ok: { type: 'boolean' }, note: { type: 'string' } }, required: ['ok'] }
const VERIFY = { type: 'object', additionalProperties: false,
  properties: { ok: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { id: { type: 'string' }, problem: { type: 'string' },
        baseline_delta: { type: 'number' } }, required: ['problem'] } } },
  required: ['ok'] }

// ---- 1. Inspect ----
phase('Inspect')
const inspect = await agent(
  `Inspect a PDF form for auto-fill.
1. Run: python3 "${skillDir}/scripts/inspect_pdf.py" "${PDF}"
2. Read the JSON it wrote (path printed on the last line, /tmp/<stem>.anchors.json).
3. Render a preview: pdftoppm -png -r 150 "${PDF}" /tmp/afpdf_src   (then you MAY Read /tmp/afpdf_src-1.png to understand layout).
Return: the page width/height; a short 'title' (top heading text of the form);
the blanks array (id, suggest_x, suggest_baseline, label_left) marking decorative=true
for any blank that is a header bar / underline / signature rule rather than a writable
field (heuristic: empty label_left AND not obviously a value line); the checkboxes array
(id, cx, cy_pdf, label_right, size=box size in pt, row=integer row index grouping boxes on the same line).`,
  { schema: INSPECT, phase: 'Inspect' })

const fields = inspect.blanks.filter(b => !b.decorative)
log(`inspect: ${fields.length} fillable fields, ${inspect.checkboxes.length} checkboxes`)

// ---- 2. Suggest (fan out: one agent per text field) ----
phase('Suggest')
const valItems = await parallel(fields.map(b => () =>
  agent(
    `Form "${inspect.title}". A blank field has the preceding label: "${b.label_left}".
Propose ONE realistic, plausible MOCK value to write on this line, in the field's own
language (Thai script if the label is Thai). Keep it short enough to fit one line.
This is sample data, not real. Return id="${b.id}", the value, and font role
(thai if the value contains Thai characters, else latin).`,
    { schema: VAL, label: `field:${b.id}`, phase: 'Suggest' })
))

// checkbox groups: one agent decides all (acceptance is correlated)
const checks = inspect.checkboxes.length
  ? await agent(
      `Form "${inspect.title}" has checkbox options. Each row is a yes/no style choice.
Checkboxes (id, center cx, center cy_pdf, label):
${JSON.stringify(inspect.checkboxes, null, 0)}
For EACH row (group by 'row'), pick exactly ONE box to tick that a cooperative supplier
would realistically choose (prefer the affirmative / "Accepted / ยอมรับ" option unless a
label clearly implies otherwise). Return chosen[] with the picked box id, its cx,
cy (use the box's cy_pdf), and size (the box's size, so the tick fits the box).`,
      { schema: CHECKS, label: 'checkboxes', phase: 'Suggest' })
  : { chosen: [] }

// ---- 3. Assemble fills.json (deterministic in JS, agent persists) ----
phase('Assemble')
const byId = {}; fields.forEach(b => { byId[b.id] = b })
const textItems = valItems.filter(Boolean).map(s => {
  const b = byId[s.id]; if (!b) return null
  return { page: 0, kind: 'text', x: b.suggest_x, baseline: b.suggest_baseline,
           text: s.value, font: s.font, size: 8.5 }
}).filter(Boolean)
const checkItems = checks.chosen.map(c => ({ page: 0, kind: 'check',
  cx: c.cx, cy: c.cy, size: c.size || 10, font: 'thai' }))
const spec = { src: PDF, out: filled, items: [...textItems, ...checkItems] }

await agent(
  `Write this EXACT JSON to ${fillsPath} (verbatim, valid JSON, real newlines), then run
\`python3 -c "import json;json.load(open('${fillsPath}'))"\` to confirm it parses.
Return ok=true if it wrote and parsed.

${JSON.stringify(spec, null, 2)}`,
  { schema: OK, label: 'write-fills', phase: 'Assemble' })

// ---- 4. Stamp ----
phase('Stamp')
await agent(
  `Run: python3 "${skillDir}/scripts/overlay_fill.py" "${fillsPath}"
It overlays the answers onto the original and writes "${filled}". Return ok=true on success
(no traceback), else ok=false with the error in note.`,
  { schema: OK, label: 'stamp', phase: 'Stamp' })

// ---- 5. Verify (+ one repair round) ----
phase('Verify')
let verdict = await agent(
  `Render and check the filled form:
1. pdftoppm -png -r 150 "${filled}" /tmp/afpdf_out
2. Read /tmp/afpdf_out-1.png.
Confirm each written value sits ON its line (not floating high/low) and each tick is INSIDE
its box. Return ok=true if good; else ok=false and issues[] with the field id and a
baseline_delta (points to move the text: + = up, - = down).`,
  { schema: VERIFY, label: 'verify', phase: 'Verify' })

if (!verdict.ok && (verdict.issues || []).length) {
  log(`verify found ${verdict.issues.length} issue(s) — repairing`)
  // apply deltas in JS, rewrite, restamp, re-verify once
  const deltas = {}; verdict.issues.forEach(i => { if (i.id) deltas[i.id] = i.baseline_delta || 0 })
  // map issue ids (field ids) back to text item index via field coords
  spec.items = spec.items.map(it => {
    if (it.kind !== 'text') return it
    return it
  })
  await agent(
    `Some filled values were misaligned. Open ${fillsPath}, and for the text items adjust
their "baseline" by these deltas (id→delta, +up/-down). Field id→item maps by matching the
field's suggest coords. Deltas: ${JSON.stringify(deltas)}.
If you cannot map by id, nudge ALL text baselines by the median delta. Save the file, then
re-run: python3 "${skillDir}/scripts/overlay_fill.py" "${fillsPath}". Return ok=true on success.`,
    { schema: OK, label: 'repair', phase: 'Verify' })
  verdict = await agent(
    `Re-render: pdftoppm -png -r 150 "${filled}" /tmp/afpdf_out2 ; Read /tmp/afpdf_out2-1.png.
Return ok=true if values sit on their lines and ticks are inside boxes.`,
    { schema: VERIFY, label: 'verify2', phase: 'Verify' })
}

return {
  output: filled,
  fields_filled: textItems.length,
  boxes_ticked: checkItems.length,
  verified: !!verdict.ok,
  fills_json: fillsPath,
}
