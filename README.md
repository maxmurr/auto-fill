# auto-fill

Upload a blank PDF form → an AI workflow fills it with mock sample answers →
download the completed PDF. The web counterpart of the `/auto-fill-pdf` skill:
the same `Inspect → Suggest → Assemble → Stamp` pipeline, with the Claude
subagents swapped for an **ai-sdk** call against an **OpenAI-compatible** model.

## Setup

1. Configure the model endpoint in `.env.local`:
   ```
   OPENAI_BASE_URL=https://your-endpoint/v1
   OPENAI_API_KEY=...        # optional for local endpoints
   AUTOFILL_MODEL=your-model-id
   ```
2. No system dependencies. The deterministic PDF mechanics are pure Node
   ([mupdf] WASM for geometry-inspect + render, [pdf-lib] + [@pdf-lib/fontkit]
   for overlay/AcroForm/flatten) and a vendored **Sarabun** font (Thai + Latin,
   OFL) under `src/lib/autofill/fonts/`. Runs on a stock Node 22 container.
   - Override the font directory with `AUTOFILL_FONTS_DIR` (must contain
     `Sarabun-Regular.ttf` + `Sarabun-Bold.ttf`).
   - Note: **mupdf is AGPL-3.0** — review its license terms before distributing.

[mupdf]: https://www.npmjs.com/package/mupdf
[pdf-lib]: https://www.npmjs.com/package/pdf-lib
[@pdf-lib/fontkit]: https://www.npmjs.com/package/@pdf-lib/fontkit

## Dev

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), drop a PDF, hit **Fill PDF**.

## How it works

- `src/app/page.tsx` — upload UI, streams workflow phases, download button.
- `src/app/api/autofill/route.ts` — upload + NDJSON progress stream.
- `src/app/api/autofill/[id]/download/route.ts` — serves the filled PDF.
- `src/lib/autofill/` — workflow: `inspect` → `suggest` (ai-sdk, one batched
  structured call; `ctx` seam reserved for future knowledge grounding) →
  `assemble` → `stamp`. Mock/sample data only.
- `src/lib/autofill/pdf/` — the pure-TS engine: `mupdf-extract` (pdfplumber-style
  primitive layer), `inspect-engine` + `acroform-engine` (layout/field detection),
  `overlay-engine` (overlay stamping on the original PDF — exact layout, no glyph
  reconstruction), `flatten` (bake widget appearances), `render` (page → PNG).
