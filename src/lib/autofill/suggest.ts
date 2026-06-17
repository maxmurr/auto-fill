import { generateText, Output } from "ai";
import { model } from "./provider";
import {
  AcroSuggestion,
  Suggestion,
  type AcroResult,
  type Checkbox,
  type InspectResult,
} from "./schemas";

/**
 * Coherent-mock principle (FORMS.md): answer as ONE clean single-ingredient
 * plant feed so every "contains allergen/GMO/animal?" → No and every
 * capability/compliance question → Yes, instead of a naive blanket-affirmative
 * bias that would wrongly tick "contains allergen → Yes".
 */
const ANSWER_LOGIC = `You are a cooperative supplier filling this blank form with realistic MOCK (sample) data — never present it as real. Picture ONE clean, single-ingredient plant feed product (e.g. corn, rice bran, or soybean meal) and keep every answer internally consistent with it.

Answer logic:
- "Does it CONTAIN / is there any allergen / GMO / animal-derived material / contaminant / banned or hazardous substance?" → No / the negative option.
- Capability, compliance, certification, documentation, "do you have / do you control / are you certified / are you able to…?" → Yes / the affirmative / "Accepted" option.
- Text values: short enough to fit one line, written in the field's own language (use Thai script when the label is Thai).
- Leave blank (do NOT answer): section/column-header rows, free-text "specify / explain / details / comment / remark" columns, and signature / approval / date-of-signing blocks.`;

/**
 * One batched structured-output call for the overlay path: a value per text
 * blank, one ticked box per checkbox row, and a mark per answerable table row.
 */
export async function suggestAnswers(ins: InspectResult): Promise<Suggestion> {
  "use step";
  const fieldLines =
    ins.fields.map((f) => `- ${f.id}: "${f.label}"`).join("\n") || "(none)";

  const groups = new Map<string, Checkbox[]>();
  for (const c of ins.checkboxes) {
    const arr = groups.get(c.row) ?? [];
    arr.push(c);
    groups.set(c.row, arr);
  }
  const groupLines =
    [...groups.values()]
      .map(
        (g, i) =>
          `Row ${i + 1}: ` +
          g.map((c) => `[${c.id}] "${c.label || "?"}"`).join("  |  "),
      )
      .join("\n") || "(none)";

  const tableLines =
    ins.tables
      .map((t) => {
        const cols = t.columns
          .map((c) => `${c.id}="${c.header || "?"}"`)
          .join(" | ");
        const rows = t.rows
          .map((r) => `  ${r.id}: "${r.label}"`)
          .join("\n");
        return `TABLE ${t.id} — columns: ${cols}\n${rows}`;
      })
      .join("\n\n") || "(none)";

  const prompt = `${ANSWER_LOGIC}
Form: "${ins.title}".

TEXT FIELDS (id: the label that precedes the blank). Propose ONE short value per field.
${fieldLines}

CHECKBOX ROWS — each row is one choice. Pick EXACTLY ONE box id per row a cooperative
respondent would tick (per the answer logic above).
${groupLines}

ANSWER TABLES — each table is a grid; each row is one question (rowId: its label) and the
columns are the possible answers. Per ANSWERABLE row, return ONE tableMarks entry:
- If the table has SEPARATE option columns (e.g. one column header is Yes / ใช่ and another
  is No / ไม่ใช่, or S / U, or scores 2 / 1 / 0): set mark="tick" and columnId = the chosen
  option column.
- If the table has a SINGLE combined answer column whose header lists several options
  (e.g. "ใช่ / ไม่ใช่ / NA"): set mark="text", columnId = that answer column, and text = the
  chosen option word.
- NEVER choose the first/label column or a details/specify/comment column. Skip (omit) rows
  that are headers or that you shouldn't answer.
${tableLines}

Return:
- values[]: { id, value, font } for every text field. font="thai" when the value contains
  Thai characters, else "latin".
- checks[]: { id } — exactly one chosen box id per checkbox row.
- tableMarks[]: { rowId, columnId, mark, text } per answered table row (text only for mark="text").`;

  const { output } = await generateText({
    model: model(),
    output: Output.object({ schema: Suggestion }),
    prompt,
  });
  return output;
}

/**
 * Suggest answers for the AcroForm path: a value per text field and a chosen
 * option (by physical-column index, left→right) per button group. Radios are
 * picked by COLUMN, not export-name — for Yes/No groups the left column is
 * usually Yes (REFERENCE.md). Unanswered groups are simply omitted (left blank).
 */
export async function suggestAcroform(acro: AcroResult): Promise<AcroSuggestion> {
  "use step";
  const textLines =
    acro.texts.map((t) => `- ${t.name}: "${t.label}"`).join("\n") || "(none)";

  const buttonLines =
    acro.buttons
      .map((b) => {
        const opts = b.options
          .map((o, i) => `[${i}] cx=${o.cx}`)
          .join(" ");
        return `- ${b.name} «${b.label || "?"}» options: ${opts}`;
      })
      .join("\n") || "(none)";

  const prompt = `${ANSWER_LOGIC}
This is an interactive AcroForm. Geometry is handled for you — just decide answers.

TEXT FIELDS (name: nearby label). Propose ONE short value per field you can answer; omit
fields that are signature / print-name / position / date-signed / company-of-signatory.
${textLines}

BUTTON GROUPS (radio / checkbox). Options are listed LEFT→RIGHT by physical column with
their x position. For a Yes/No group the LEFT option (index 0) is normally Yes and the right
is No. Per group you answer, return { name, optionIndex } choosing the column per the answer
logic. OMIT groups you should leave blank (sub-questions that don't apply, signature, etc.).
${buttonLines}

Return:
- texts[]: { name, value, font } for answered text fields (font="thai" if the value has Thai).
- buttons[]: { name, optionIndex } for answered groups only.`;

  const { output } = await generateText({
    model: model(),
    output: Output.object({ schema: AcroSuggestion }),
    prompt,
  });
  return output;
}
