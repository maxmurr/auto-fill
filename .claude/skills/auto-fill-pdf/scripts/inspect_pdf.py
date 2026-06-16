#!/usr/bin/env python3
"""Inspect a PDF for auto-fill: page geometry, AcroForm fields, blank fill-rules,
and checkbox squares — each with nearby label text. Emits JSON to <out> and a
short human summary to stdout.

Usage: python3 inspect_pdf.py SRC.pdf [OUT.json]
Default OUT: /tmp/<stem>.anchors.json
"""
import sys, json, os

def main():
    if len(sys.argv) < 2:
        print("usage: inspect_pdf.py SRC.pdf [OUT.json]", file=sys.stderr); sys.exit(2)
    src = sys.argv[1]
    stem = os.path.splitext(os.path.basename(src))[0]
    out = sys.argv[2] if len(sys.argv) > 2 else f"/tmp/{stem}.anchors.json"

    import pdfplumber
    data = {"src": os.path.abspath(src), "pages": []}

    # ---- AcroForm fields (pypdf) ----
    acro = []
    try:
        from pypdf import PdfReader
        r = PdfReader(src)
        fields = r.get_fields()
        if fields:
            for name, f in fields.items():
                acro.append({"name": name,
                             "type": str(f.get('/FT')),
                             "value": str(f.get('/V'))})
    except Exception as e:
        acro = [{"error": str(e)}]
    data["acroform_fields"] = acro

    pdf = pdfplumber.open(src)
    for pi, p in enumerate(pdf.pages):
        H = float(p.height); W = float(p.width)
        words = p.extract_words(extra_attrs=['size', 'fontname'])

        def label_left(y_top, x_lim, band=7):
            """words ending left of x_lim whose row ~ y_top."""
            picks = [w for w in words
                     if abs(w['bottom'] - y_top) < band and w['x1'] <= x_lim + 2]
            picks.sort(key=lambda w: w['x0'])
            return " ".join(w['text'] for w in picks)[-80:]

        def label_right(top, bottom, x_from, band=6, maxdx=140):
            cy = (top + bottom) / 2
            picks = [w for w in words
                     if abs((w['top'] + w['bottom']) / 2 - cy) < band
                     and w['x0'] >= x_from - 1 and w['x0'] - x_from < maxdx]
            picks.sort(key=lambda w: w['x0'])
            return " ".join(w['text'] for w in picks)[:60]

        # ---- blank fill-rules: thin horizontal lines + thin filled rects ----
        rules = []
        for l in p.lines:
            if abs(l['top'] - l['bottom']) < 0.9 and abs(l['x1'] - l['x0']) > 20:
                rules.append((min(l['x0'], l['x1']), max(l['x0'], l['x1']), l['top']))
        for rc in p.rects:
            h = rc['bottom'] - rc['top']
            if rc.get('fill') and h < 1.3 and (rc['x1'] - rc['x0']) > 20:
                rules.append((rc['x0'], rc['x1'], (rc['top'] + rc['bottom']) / 2))
        # dedup by rounded (x0,x1,y)
        seen = set(); blanks = []
        for x0, x1, top in sorted(rules, key=lambda t: (round(t[2]), t[0])):
            k = (round(x0), round(x1), round(top))
            if k in seen: continue
            seen.add(k)
            blanks.append({
                "id": f"p{pi}_L{len(blanks)}",
                "x0": round(x0, 1), "x1": round(x1, 1),
                "pdf_y_line": round(H - top, 1),
                "suggest_x": round(x0 + 3, 1),
                "suggest_baseline": round(H - top + 2.2, 1),
                "label_left": label_left(top, x0),
            })

        # ---- checkbox squares: stroked ~square rects 6..22pt ----
        cboxes = []; cseen = set()
        for rc in p.rects:
            w = rc['x1'] - rc['x0']; h = rc['bottom'] - rc['top']
            ar = (w / h) if h else 99
            if rc.get('stroke') and 7 <= w <= 26 and 6 <= h <= 22 and 0.6 <= ar <= 2.6:
                k = (round(rc['x0']), round(rc['top']))
                if k in cseen: continue
                cseen.add(k)
                cboxes.append({
                    "id": f"p{pi}_C{len(cboxes)}",
                    "x0": round(rc['x0'], 1), "x1": round(rc['x1'], 1),
                    "top": round(rc['top'], 1), "bottom": round(rc['bottom'], 1),
                    "cx": round((rc['x0'] + rc['x1']) / 2, 1),
                    "cy_pdf": round(H - (rc['top'] + rc['bottom']) / 2, 1),
                    "size": round(min(w, h), 1),
                    "label_right": label_right(rc['top'], rc['bottom'], rc['x1']),
                })
        # ---- glyph checkboxes: empty-box characters (☐ □ ❑ ▢ ...) ----
        # Some forms draw boxes as font glyphs, not vector rects, so the rect
        # detector above finds nothing. Pick them up from p.chars by codepoint.
        BOX_GLYPHS = {0x2610, 0x25A1, 0x2751, 0x274F, 0x2B1C, 0x25FB, 0x2752,
                      0x2B26, 0x2B27, 0x274F, 0x25A2, 0x25AB, 0x2B1A}
        for c in p.chars:
            t = c.get('text', '')
            if len(t) != 1 or ord(t) not in BOX_GLYPHS:
                continue
            k = (round(c['x0']), round(c['top']))
            if k in cseen: continue
            cseen.add(k)
            w = c['x1'] - c['x0']; h = c['bottom'] - c['top']
            cboxes.append({
                "id": f"p{pi}_C{len(cboxes)}",
                "x0": round(c['x0'], 1), "x1": round(c['x1'], 1),
                "top": round(c['top'], 1), "bottom": round(c['bottom'], 1),
                "cx": round((c['x0'] + c['x1']) / 2, 1),
                "cy_pdf": round(H - (c['top'] + c['bottom']) / 2, 1),
                "size": round(min(w, h), 1),
                "label_right": label_right(c['top'], c['bottom'], c['x1']),
            })
        cboxes.sort(key=lambda b: (round(b['top']), b['x0']))

        data["pages"].append({
            "index": pi, "width": round(W, 2), "height": round(H, 2),
            "blanks": blanks, "checkboxes": cboxes,
        })

    with open(out, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # human summary
    print(f"src: {data['src']}")
    print(f"acroform_fields: {len(data['acroform_fields'])}")
    for pg in data["pages"]:
        print(f"page {pg['index']}: {pg['width']}x{pg['height']}  "
              f"blanks={len(pg['blanks'])} checkboxes={len(pg['checkboxes'])}")
        for b in pg["blanks"]:
            print(f"  BLANK {b['id']:>8}  x{b['suggest_x']:>6} y{b['suggest_baseline']:>6}  «{b['label_left']}»")
        for ch in pg["checkboxes"]:
            print(f"  CHECK {ch['id']:>8}  cx{ch['cx']:>6} cy{ch['cy_pdf']:>6}  → {ch['label_right']}")
    print(f"\nanchors -> {out}")

if __name__ == "__main__":
    main()
