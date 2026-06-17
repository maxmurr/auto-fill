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
        # ---- curve checkboxes: rounded-square boxes drawn as curves ----
        # Some forms (e.g. 50_E cert row: ISO/GMP/HACCP) draw the box as a
        # rounded rectangle = a `curve`, not a stroked rect or a font glyph, so
        # both detectors above miss it. Pick up near-square stroked curves in
        # the checkbox size range, deduped against rect/glyph boxes.
        for cv in p.curves:
            w = cv['x1'] - cv['x0']; h = cv['bottom'] - cv['top']
            ar = (w / h) if h else 99
            if 8 <= w <= 26 and 8 <= h <= 22 and 0.6 <= ar <= 2.0:
                k = (round(cv['x0']), round(cv['top']))
                if k in cseen:
                    continue
                cseen.add(k)
                cboxes.append({
                    "id": f"p{pi}_C{len(cboxes)}",
                    "x0": round(cv['x0'], 1), "x1": round(cv['x1'], 1),
                    "top": round(cv['top'], 1), "bottom": round(cv['bottom'], 1),
                    "cx": round((cv['x0'] + cv['x1']) / 2, 1),
                    "cy_pdf": round(H - (cv['top'] + cv['bottom']) / 2, 1),
                    "size": round(min(w, h), 1),
                    "label_right": label_right(cv['top'], cv['bottom'], cv['x1']),
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

        # ---- rect-grid matrix tables (scoring / Yes-No matrices) ----
        # Many audit forms draw their answer grid as thin rects/lines with NO
        # checkbox squares (checkboxes=0). The cell to tick is then a column x
        # center at a row y band. Reconstruct that grid so the caller doesn't
        # have to re-derive geometry per form. (See defects log seeded #2.)
        from collections import defaultdict as _dd

        def _vsegs():
            segs = []
            for l in p.lines:
                if abs(l['x1'] - l['x0']) < 1 and abs(l['top'] - l['bottom']) > 12:
                    segs.append((round((l['x0'] + l['x1']) / 2, 1), l['top'], l['bottom']))
            for rc in p.rects:
                if abs(rc['x1'] - rc['x0']) < 2 and (rc['bottom'] - rc['top']) > 12:
                    segs.append((round((rc['x0'] + rc['x1']) / 2, 1), rc['top'], rc['bottom']))
            return segs

        def _hborders():
            cov = _dd(lambda: [1e9, -1e9])
            for l in p.lines:
                if abs(l['top'] - l['bottom']) < 1 and abs(l['x1'] - l['x0']) > 5:
                    yk = round(l['top']); cov[yk][0] = min(cov[yk][0], min(l['x0'], l['x1'])); cov[yk][1] = max(cov[yk][1], max(l['x0'], l['x1']))
            for rc in p.rects:
                if (rc['bottom'] - rc['top']) < 2 and (rc['x1'] - rc['x0']) > 5:
                    yk = round((rc['top'] + rc['bottom']) / 2); cov[yk][0] = min(cov[yk][0], rc['x0']); cov[yk][1] = max(cov[yk][1], rc['x1'])
            return cov

        tables = []
        vseg = _vsegs()
        vcount = _dd(int)
        for x, _t, _b in vseg:
            vcount[x] += 1
        # column edges = x's drawn repeatedly (grid lines, one per row) — collapse near-dupes
        edges = sorted(x for x, c in vcount.items() if c >= 3)
        merged = []
        for x in edges:
            if merged and x - merged[-1] < 4:
                continue
            merged.append(x)
        if len(merged) >= 3:
            xmin, xmax = merged[0], merged[-1]
            cov = _hborders()
            borders = sorted(y for y, (a, b) in cov.items()
                             if a <= xmin + 8 and b >= xmax - 8)
            if len(borders) >= 3:
                cols = [{"x0": merged[i], "x1": merged[i + 1],
                         "cx": round((merged[i] + merged[i + 1]) / 2, 1)}
                        for i in range(len(merged) - 1)]
                # header words per column: nearest words just below the first border
                top0 = borders[0]
                for c in cols:
                    hw = [w for w in words
                          if top0 - 2 < w['top'] < borders[min(1, len(borders) - 1)] + 2
                          and c['x0'] - 1 <= (w['x0'] + w['x1']) / 2 <= c['x1'] + 1]
                    hw.sort(key=lambda w: w['x0'])
                    c["header"] = " ".join(w['text'] for w in hw)[:28]
                # grey header/section bands: wide greyish filled rects. Scoring
                # matrices shade sub-group headers / column-header rows grey, so
                # a row overlapping one is a header (skip it, don't tick).
                grey_bands = []
                for rc in p.rects:
                    col = rc.get('non_stroking_color')
                    if (rc.get('fill') and isinstance(col, (list, tuple))
                            and len(col) == 3 and all(0.55 <= c <= 0.92 for c in col)
                            and max(col) - min(col) < 0.05
                            and (rc['x1'] - rc['x0']) > 110 and (rc['bottom'] - rc['top']) > 3):
                        grey_bands.append((rc['top'], rc['bottom']))
                rows = []
                for a, b in zip(borders, borders[1:]):
                    cyt = (a + b) / 2
                    lab = [w for w in words
                           if a - 1 <= (w['top'] + w['bottom']) / 2 <= b + 1
                           and w['x1'] <= cols[0]['x1'] + 1]
                    lab.sort(key=lambda w: (round(w['top']), w['x0']))
                    rows.append({
                        "top": round(a, 1), "bottom": round(b, 1),
                        "cy_pdf": round(H - cyt, 1),
                        "h": round(b - a, 1),
                        "grey": any(gt - 1 <= cyt <= gb + 1 for gt, gb in grey_bands),
                        "label_left": " ".join(w['text'] for w in lab)[:90],
                    })
                tables.append({"id": f"p{pi}_T0",
                               "x0": xmin, "x1": xmax,
                               "columns": cols, "rows": rows})

        data["pages"].append({
            "index": pi, "width": round(W, 2), "height": round(H, 2),
            "blanks": blanks, "checkboxes": cboxes, "tables": tables,
        })

    with open(out, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # human summary
    print(f"src: {data['src']}")
    print(f"acroform_fields: {len(data['acroform_fields'])}")
    for pg in data["pages"]:
        print(f"page {pg['index']}: {pg['width']}x{pg['height']}  "
              f"blanks={len(pg['blanks'])} checkboxes={len(pg['checkboxes'])} "
              f"tables={len(pg.get('tables', []))}")
        for t in pg.get("tables", []):
            cols = " | ".join(f"{c['cx']}«{c.get('header','')}»" for c in t['columns'])
            print(f"  TABLE {t['id']} cols: {cols}")
            for r in t["rows"]:
                print(f"    ROW cy{r['cy_pdf']:>6} h{r['h']:>5}  «{r['label_left'][:60]}»")
        for b in pg["blanks"]:
            print(f"  BLANK {b['id']:>8}  x{b['suggest_x']:>6} y{b['suggest_baseline']:>6}  «{b['label_left']}»")
        for ch in pg["checkboxes"]:
            print(f"  CHECK {ch['id']:>8}  cx{ch['cx']:>6} cy{ch['cy_pdf']:>6}  → {ch['label_right']}")
    print(f"\nanchors -> {out}")

if __name__ == "__main__":
    main()
