import { generateText, Output } from "ai";
import { model } from "./provider";
import { Suggestion, type Checkbox, type InspectResult } from "./schemas";

/**
 * One batched structured-output call: a value per text field + one ticked box
 * per checkbox row. Pure mock data — no external knowledge grounding.
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

  const prompt = `You are filling in a blank form with realistic MOCK (sample) data. This is sample data — never present it as real.
Form: "${ins.title}".

TEXT FIELDS (id: the label that precedes the blank). Propose ONE short, plausible value
per field, written in the field's own language (use Thai script when the label is Thai).
Keep each value short enough to fit on a single line.
${fieldLines}

CHECKBOX ROWS — each row is one choice. Pick EXACTLY ONE box id per row that a cooperative
respondent would realistically tick (prefer the affirmative / "ยอมรับ / Accepted / Yes"
option unless a label clearly implies otherwise).
${groupLines}

Return:
- values[]: { id, value, font } for every text field id listed above. Set font="thai" when
  the value contains Thai characters, otherwise font="latin".
- checks[]: { id } — exactly one chosen box id per checkbox row.`;

  const { output } = await generateText({
    model: model(),
    output: Output.object({ schema: Suggestion }),
    prompt,
  });
  return output;
}
