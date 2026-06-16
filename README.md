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
2. Requires Python 3 with `pdfplumber reportlab pypdf` and `pdftoppm` (poppler)
   on PATH — the deterministic PDF mechanics live in `pyscripts/`.

## Dev

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), drop a PDF, hit **Fill PDF**.

## How it works

- `src/app/page.tsx` — upload UI, streams workflow phases, download button.
- `src/app/api/autofill/route.ts` — upload + NDJSON progress stream.
- `src/app/api/autofill/[id]/download/route.ts` — serves the filled PDF.
- `src/lib/autofill/` — workflow: `inspect` (py) → `suggest` (ai-sdk, one batched
  structured call; `ctx` seam reserved for future knowledge grounding) →
  `assemble` → `stamp` (py). Mock/sample data only.
- `pyscripts/inspect_pdf.py` / `overlay_fill.py` — layout detection + overlay
  stamping on the original PDF (exact layout, no glyph reconstruction).
