#!/usr/bin/env python3
"""Generate /tmp/auto_fill_fills.json for the 50_E Evershining scoring matrix
(FM-PU-09). Self-contained geometry (no dependence on inspect `tables`):
  - the form mixes TWO answer-table types on the same right-hand grid
    (dividers 432.1│477.8│523.6│569.3):
      * SCORE sections (1-5): columns 2│1│0 → tick "2" (cx=455.0);
      * Yes/No sections (6 Labor, 7 Transport, 8 traceability): columns
        มี│ไม่มี → tick มี / "Yes" (cx=500.7, the 477.8│523.6 cell center).
    Both share the 477.8 and 523.6 dividers, so a row's geometry alone can't
    tell them apart — the table TYPE is read from each reprinted column-header
    row ("คะแนน/Point" = score, "มี/ไม่มี" = Yes/No) and carried down its rows;
  - tick GMP + HACCP cert boxes (drawn as rounded-square *curves*);
  - stamp header text (mock) on the dotted leaders of page 0.
Reusable across dir1/2/3 50_E (identical template); vary only HDR mock.
"""
import sys, json
import pdfplumber

SRC = sys.argv[1]
OUT = sys.argv[2]
HDR = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}

X2 = 455.0          # "2" score column center (432.1│477.8)
MI_CX = 500.7       # มี / "Yes" column center on Yes/No tables (477.8│523.6)
DIV = 477.8         # right divider of the "2" column (2|1 boundary)
SKIP_TXT = ("ประเมิน", "ประเมนิ", "Evaluatio", "คะแนน", "Point")  # column-header words

pdf = pdfplumber.open(SRC)

def is_greyish(col):
    return (isinstance(col, (list, tuple)) and len(col) == 3
            and all(0.55 <= c <= 0.92 for c in col)
            and max(col) - min(col) < 0.05)

def grey_bands(p):
    out = []
    for rc in p.rects:
        if rc.get('fill') and is_greyish(rc.get('non_stroking_color')) \
           and (rc['x1'] - rc['x0']) > 110 and (rc['bottom'] - rc['top']) > 3:
            out.append((rc['top'], rc['bottom']))
    return out

def vseg_merged(p, xt=DIV, tol=2.5):
    segs = []
    for l in p.lines:
        if abs(l['x1'] - l['x0']) < 1 and abs(l['top'] - l['bottom']) > 8 \
           and abs((l['x0'] + l['x1']) / 2 - xt) < tol:
            segs.append([min(l['top'], l['bottom']), max(l['top'], l['bottom'])])
    for rc in p.rects:
        if abs(rc['x1'] - rc['x0']) < 2 and (rc['bottom'] - rc['top']) > 8 \
           and abs((rc['x0'] + rc['x1']) / 2 - xt) < tol:
            segs.append([rc['top'], rc['bottom']])
    segs.sort()
    merged = []
    for s in segs:
        if merged and s[0] <= merged[-1][1] + 1:
            merged[-1][1] = max(merged[-1][1], s[1])
        else:
            merged.append([s[0], s[1]])
    return merged

def hborders(p, x=X2):
    ys = set()
    for l in p.lines:
        if abs(l['top'] - l['bottom']) < 1 and min(l['x0'], l['x1']) <= x <= max(l['x0'], l['x1']):
            ys.add(round(l['top'], 1))
    for rc in p.rects:
        if (rc['bottom'] - rc['top']) < 2 and rc['x0'] <= x <= rc['x1']:
            ys.add(round((rc['top'] + rc['bottom']) / 2, 1))
    return sorted(ys)

pages_out = []
n_ticks = 0
for pi, p in enumerate(pdf.pages):
    H = float(p.height)
    words = p.extract_words()
    greys = grey_bands(p)
    hb = hborders(p)
    # scored region = union of the two INTERNAL score-block dividers
    # (2|1 at 477.8, 1|0 at 523.6). Only real answer cells are subdivided by
    # these; merged header/title cells span the block undivided. OR the two so
    # one fills the other's rendering gap (seeded defect #2) — e.g. row 6.3.1
    # is missed by 477.8 but covered by 523.6. The OUTER edges (432.1/569.3)
    # are deliberately excluded: they run the full form height and would gate
    # the page-0 header block and white section-title bars.
    covsegs = []
    for xd in (DIV, 523.6):
        covsegs += vseg_merged(p, xd)
    def covered(yt):
        return any(t - 1 <= yt <= b + 1 for t, b in covsegs)

    def label_at(t, b):
        lab = [w for w in words
               if t - 1 <= (w['top'] + w['bottom']) / 2 <= b + 1 and w['x1'] <= 433]
        lab.sort(key=lambda w: (round(w['top']), w['x0']))
        return " ".join(w['text'] for w in lab)

    checks = []
    cur_type = "score"                       # the form opens with score sections
    borders = sorted(set(round(y, 1) for y in hb))
    for a, c in zip(borders, borders[1:]):
        h = c - a
        if h < 10:                           # too thin to be a real row
            continue
        midtop = (a + c) / 2
        bw = [w for w in words
              if a - 1 <= (w['top'] + w['bottom']) / 2 <= c + 1]
        # ---- table-type switch (independent of covered/grey) ----
        # A reprinted column-header row sets which answer column the rows below
        # use. Detect by the answer-column header text, NOT bare "มี/ไม่มี":
        # "ไม่มี" also occurs in score *labels* (e.g. 1.2.2.2 «ไม่มีน้ำขัง»),
        # so require it to sit in the answer columns (x0 > 475); "Point" (the
        # English half of "คะแนน/Point") only ever appears in a score header.
        if any(w['text'].strip() in ('ไม่มี', '(No)') and w['x0'] > 475 for w in bw):
            cur_type = "yesno"
            continue
        if any('Point' in w['text'] for w in bw):
            cur_type = "score"
            continue
        if not covered(midtop):              # outside the answer grid
            continue
        cy = midtop
        if any(g[0] - 1 <= cy <= g[1] + 1 for g in greys):
            continue                         # grey header / section bar
        lab = label_at(a, c)
        if any(s in lab for s in SKIP_TXT):
            continue                         # other header / title row
        checks.append({"kind": "check", "cx": MI_CX if cur_type == "yesno" else X2,
                       "cy_pdf": round(H - cy, 1),
                       "_label": lab[:42]})
        n_ticks += 1
    pages_out.append({"index": pi, "items": checks})

# ---- cert boxes (curves) on page 0: GMP + HACCP (row 1, cy~532) ----
p0 = pdf.pages[0]; H0 = float(p0.height)
boxes = []
for cv in p0.curves:
    w = cv['x1'] - cv['x0']; h = cv['bottom'] - cv['top']
    cyv = H0 - (cv['top'] + cv['bottom']) / 2
    if 8 < w < 26 and 8 < h < 22 and 525 < cyv < 540:
        boxes.append((round((cv['x0'] + cv['x1']) / 2, 1), round(cyv, 1)))
boxes = sorted(set(boxes))
p0_items = pages_out[0]['items']
for name, cx in (("GMP", 284.8), ("HACCP", 471.8)):
    cand = [b for b in boxes if abs(b[0] - cx) < 6]
    if cand:
        p0_items.append({"kind": "check", "cx": cand[0][0], "cy_pdf": cand[0][1],
                         "_label": f"cert:{name}"})
        n_ticks += 1

# ---- header text on page 0 (mock on dotted leaders) ----
ws0 = p0.extract_words()
def after_label(substr, dx=4):
    cand = [w for w in ws0 if substr in w['text']]
    if not cand:
        return None
    w = cand[0]
    return (round(w['x1'] + dx, 1), round(H0 - w['bottom'] + 1.5, 1))
for sub, key in (("Supplier", "supplier"), ("Date", "date"), ("Goods", "goods"),
                 ("Product", "product"), ("materials", "source")):
    val = HDR.get(key, "")
    pos = after_label(sub)
    if val and pos:
        p0_items.append({"kind": "text", "x": pos[0], "baseline": pos[1],
                         "text": val, "size": 11, "font": "thai", "_label": f"hdr:{sub}"})

import os
# flatten to overlay_fill.py native schema (flat items, page index, check uses cy)
flat = []
for pgo in pages_out:
    pi = pgo['index']
    for it in pgo['items']:
        if it['kind'] == 'check':
            flat.append({"page": pi, "kind": "check", "cx": it['cx'],
                         "cy": it['cy_pdf'], "size": 12, "mark": "✓",
                         "color": [0.05, 0.05, 0.55]})
        else:
            flat.append({"page": pi, "kind": "text", "x": it['x'],
                         "baseline": it['baseline'], "text": it['text'],
                         "font": it.get('font', 'thai'), "size": it.get('size', 11),
                         "color": [0.05, 0.05, 0.55]})
srcabs = os.path.abspath(SRC)
outpdf = os.path.join(os.path.dirname(srcabs),
                      os.path.splitext(os.path.basename(srcabs))[0] + "_Filled.pdf")
json.dump({"src": srcabs, "out": outpdf, "items": flat},
          open(OUT, "w"), ensure_ascii=False, indent=2)
print(f"total ticks: {n_ticks}")
for pgo in pages_out:
    nc = sum(1 for i in pgo['items'] if i['kind'] == 'check')
    nt = sum(1 for i in pgo['items'] if i['kind'] == 'text')
    print(f"  page {pgo['index']}: {nc} checks, {nt} text")
    for i in pgo['items']:
        if i['kind'] == 'check':
            print(f"     ✓ cx{i['cx']} cy{i['cy_pdf']}  «{i.get('_label','')}»")
        else:
            print(f"     T x{i['x']} y{i['baseline']}  «{i.get('_label','')}={i['text']}»")
