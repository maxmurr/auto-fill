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
       "font":"thai","size":8.5,"color":[0.05,0.05,0.55]},
    {"page":0,"kind":"check","cx":70,"cy":579,"size":10,
       "mark":"✓","font":"thai","color":[0.05,0.05,0.55]}
  ]
}

Coordinates are PDF points, origin bottom-left (matches inspect_pdf suggest_* / cy_pdf).
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

def main():
    if len(sys.argv) < 2:
        print("usage: overlay_fill.py fills.json", file=sys.stderr); sys.exit(2)
    spec = json.load(open(sys.argv[1]))
    src = spec["src"]
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
        for it in items_by_page.get(pi, []):
            color = it.get("color", [0.05, 0.05, 0.55])
            cv.setFillColorRGB(*color)
            fnt = role_font.get(it.get("font", "latin"), "Helvetica")
            if it["kind"] == "text":
                cv.setFont(fnt, it.get("size", 8.5))
                cv.drawString(float(it["x"]), float(it["baseline"]), it["text"])
            elif it["kind"] == "check":
                size = it.get("size", 10)
                cx = float(it["cx"]); cy = float(it["cy"])
                mark = it.get("mark", "✓")
                # Glyph marks (✓/✗) are unreliable across system TTFs (render as
                # tofu). Draw a vector tick/cross instead — always renders, scales
                # cleanly, and sits centered on (cx, cy).
                if mark in ("✓", "check", "tick", "x", "X", "✗", "✕"):
                    cv.setStrokeColorRGB(*color)
                    cv.setLineWidth(max(1.0, size * 0.12))
                    cv.setLineCap(1)
                    s = size * 0.5
                    if mark in ("x", "X", "✗", "✕"):
                        cv.line(cx - s, cy - s, cx + s, cy + s)
                        cv.line(cx - s, cy + s, cx + s, cy - s)
                    else:  # checkmark
                        cv.line(cx - s * 0.85, cy + s * 0.05,
                                cx - s * 0.18, cy - s * 0.75)
                        cv.line(cx - s * 0.18, cy - s * 0.75,
                                cx + s * 0.95, cy + s * 0.85)
                else:
                    cv.setFont(role_font.get(it.get("font", "thai")), size)
                    cv.drawCentredString(cx, cy - size * 0.36, mark)
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
