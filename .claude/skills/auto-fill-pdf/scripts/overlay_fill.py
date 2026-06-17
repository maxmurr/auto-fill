#!/usr/bin/env python3
"""Stamp answers onto an existing PDF as an overlay layer (original untouched).

Reads a fills.json:
{
  "src": "in.pdf",
  "out": "in_Filled.pdf",
  "fonts": {                      # optional path overrides per role
     "thai": "...ttf", "thai-bold": "...", "latin": "...", "latin-bold": "..."
  },
  "items": [
    {"page":0,"kind":"text","x":270,"baseline":743,"text":"...",
       "font":"thai","size":8.5,"align":"left","color":[0.05,0.05,0.55]},
    {"page":0,"kind":"check","cx":70,"cy":579,"size":10,
       "mark":"✓","font":"thai","color":[0.05,0.05,0.55]},
    {"page":0,"kind":"check","cx":488,"cy_pdf":300,"w":34,"h":12,"mark":"circle"}
  ]
}

Coordinates are PDF points, origin bottom-left (matches inspect_pdf suggest_* / cy_pdf).
Per item:
  text  : x, baseline, text   (+ align "left"|"center"|"right", font, size)
  check : cx + (cy OR cy_pdf) (+ size, mark, font)
          mark "✓"/"check"/"tick" or "x"/"X" → vector mark, vertically CENTERED
              and bounded in a size×size box at (cx,cy); set size ≈ the box size
              and it always lands inside the box.
          mark "circle"/"oval"            → stroked ellipse (w×h, default size);
              to circle a word/option, pass cx,cy = its center, w,h = its bbox+pad.
          any other mark string           → drawn as a font glyph (may tofu).
Usage: python3 overlay_fill.py fills.json
"""
import sys, json, io, os

# candidate font files by role (first existing wins)
FONT_CANDIDATES = {
    "thai": ["/System/Library/Fonts/Supplemental/Tahoma.ttf",
             "/System/Library/Fonts/Supplemental/Sarabun-Regular.ttf",
             "/Library/Fonts/Arial Unicode.ttf",
             "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"],
    "thai-bold": ["/System/Library/Fonts/Supplemental/Tahoma Bold.ttf",
                  "/System/Library/Fonts/Supplemental/Tahoma.ttf"],
    "latin": ["/System/Library/Fonts/Supplemental/Arial.ttf",
              "/Library/Fonts/Arial.ttf"],
    "latin-bold": ["/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                   "/System/Library/Fonts/Supplemental/Arial.ttf"],
}


def _need(it, keys, pi, idx):
    """Fail loudly (with item locus) when a required field is missing —
    a wrong/blank stamp is far costlier than an early, explicit error."""
    missing = [k for k in keys if k not in it]
    if missing:
        raise ValueError(f"item p{pi}#{idx} ({it.get('kind')}) missing {missing}")


def main():
    if len(sys.argv) < 2:
        print("usage: overlay_fill.py fills.json", file=sys.stderr); sys.exit(2)
    spec = json.load(open(sys.argv[1]))
    src = spec.get("src")
    if not src:
        sys.exit("fills.json missing required 'src'")
    if not os.path.exists(src):
        sys.exit(f"src PDF not found: {src}")
    out = spec.get("out") or os.path.splitext(src)[0] + "_Filled.pdf"

    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from pypdf import PdfReader, PdfWriter

    # register fonts (role -> registered name)
    overrides = spec.get("fonts", {})
    role_font = {}
    for role, cands in FONT_CANDIDATES.items():
        paths = ([overrides[role]] if role in overrides else []) + cands
        for pth in paths:
            if pth and os.path.exists(pth):
                regname = f"f_{role}"
                try:
                    pdfmetrics.registerFont(TTFont(regname, pth)); role_font[role] = regname
                    break
                except Exception:
                    continue
        role_font.setdefault(role, "Helvetica")

    reader = PdfReader(src)
    npages = len(reader.pages)

    # build one overlay PDF (all pages) in memory
    buf = io.BytesIO()
    # page sizes from source
    sizes = []
    for pg in reader.pages:
        box = pg.mediabox
        sizes.append((float(box.width), float(box.height)))
    cv = canvas.Canvas(buf, pagesize=sizes[0])
    items_by_page = {}
    for it in spec["items"]:
        items_by_page.setdefault(int(it.get("page", 0)), []).append(it)

    for pi in range(npages):
        cv.setPageSize(sizes[pi])
        for idx, it in enumerate(items_by_page.get(pi, [])):
            kind = it.get("kind")
            color = it.get("color", [0.05, 0.05, 0.55])
            cv.setFillColorRGB(*color)
            cv.setStrokeColorRGB(*color)
            fnt = role_font.get(it.get("font", "latin"), "Helvetica")
            if kind == "text":
                _need(it, ("x", "baseline", "text"), pi, idx)
                cv.setFont(fnt, it.get("size", 8.5))
                # align: "left" (default) anchors text at x; "center"/"right" let
                # x be the cell center / right edge — needed to drop an answer word
                # (e.g. ใช่/ไม่ใช่) dead-center in a single-answer grid column.
                align = it.get("align", "left")
                x = float(it["x"]); b = float(it["baseline"]); t = str(it["text"])
                if align == "center":
                    cv.drawCentredString(x, b, t)
                elif align == "right":
                    cv.drawRightString(x, b, t)
                else:
                    cv.drawString(x, b, t)
            elif kind == "check":
                _need(it, ("cx",), pi, idx)
                size = float(it.get("size", 10))
                cx = float(it["cx"])
                # Accept cy OR cy_pdf — same value (PDF bottom-left origin); inspect
                # and the helpers emit cy_pdf, and forgetting to remap it to cy used
                # to KeyError / drop the mark to y=0. Take whichever is present.
                if "cy" in it:
                    cy = float(it["cy"])
                elif "cy_pdf" in it:
                    cy = float(it["cy_pdf"])
                else:
                    raise ValueError(f"check item p{pi}#{idx} needs 'cy' (or 'cy_pdf')")
                mark = it.get("mark", "✓")
                if mark in ("circle", "oval", "o", "O", "◯", "○"):
                    # Stroked ellipse centered on (cx, cy). To CIRCLE a word/option,
                    # pass cx,cy = its center and w,h = its bbox + a few pt padding.
                    w = float(it.get("w", size)); h = float(it.get("h", size))
                    cv.setLineWidth(max(1.0, size * 0.1))
                    cv.ellipse(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2,
                               stroke=1, fill=0)
                elif mark in ("✓", "check", "tick", "x", "X", "✗", "✕"):
                    # Glyph marks (✓/✗) tofu on many system TTFs — draw a vector
                    # tick/cross instead. Ink is vertically CENTERED and bounded
                    # within a size×size box at (cx, cy): pass size ≈ the box size
                    # and the mark always lands inside the box (no top-rim overshoot
                    # on small radios).
                    cv.setLineWidth(max(1.0, size * 0.12))
                    cv.setLineCap(1); cv.setLineJoin(1)
                    if mark in ("x", "X", "✗", "✕"):
                        d = size * 0.42
                        cv.line(cx - d, cy - d, cx + d, cy + d)
                        cv.line(cx - d, cy + d, cx + d, cy - d)
                    else:  # checkmark — short down-left arm to vertex, long up-right
                        cv.line(cx - 0.42 * size, cy - 0.05 * size,
                                cx - 0.15 * size, cy - 0.37 * size)
                        cv.line(cx - 0.15 * size, cy - 0.37 * size,
                                cx + 0.45 * size, cy + 0.37 * size)
                else:
                    cv.setFont(role_font.get(it.get("font", "thai"), "Helvetica"), size)
                    cv.drawCentredString(cx, cy - size * 0.36, mark)
            else:
                raise ValueError(f"item p{pi}#{idx}: unknown kind {kind!r} "
                                 f"(expected 'text' or 'check')")
        cv.showPage()
    cv.save()
    buf.seek(0)

    overlay = PdfReader(buf)
    writer = PdfWriter()
    for pi in range(npages):
        base = reader.pages[pi]
        if pi < len(overlay.pages):
            base.merge_page(overlay.pages[pi])
        writer.add_page(base)
    with open(out, "wb") as f:
        writer.write(f)
    print("fonts:", {k: os.path.basename(v) if v.endswith('.ttf') else v for k, v in
                     [(r, next((p for p in ([overrides.get(r)] + FONT_CANDIDATES[r]) if p and os.path.exists(p)), 'Helvetica')) for r in FONT_CANDIDATES]})
    print("wrote", out)

if __name__ == "__main__":
    main()
