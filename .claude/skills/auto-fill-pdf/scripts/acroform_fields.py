#!/usr/bin/env python3
"""Extract AcroForm field geometry for the overlay path.

`inspect_pdf.py` reports *how many* AcroForm fields a PDF has, but not where they
are. For Thai / non-Latin forms you can't fill the fields with pypdf (the form's
/DA font tofus Thai) — instead you flatten the widgets and stamp values on each
field's /Rect with overlay_fill.py (see REFERENCE.md "AcroForm path" + D3). This
script emits the geometry that overlay needs:

  - text fields  → name, label (nearby words), rect [x0,y0,x1,y1] (PDF bottom-left)
  - button groups (radio / checkbox) → options[], each a kid widget with its
    on-state name and rect center (cx,cy) + size. Tick radios by PHYSICAL COLUMN
    (option cx), not export-name — state names are arbitrary and sometimes
    reversed within one form.

Coordinates are PDF points, origin bottom-left (matches overlay_fill.py).
Usage: python3 acroform_fields.py SRC.pdf [OUT.json]   (default /tmp/<stem>.acro.json)
"""
import sys, json, os


def main():
    if len(sys.argv) < 2:
        print("usage: acroform_fields.py SRC.pdf [OUT.json]", file=sys.stderr)
        sys.exit(2)
    src = sys.argv[1]
    stem = os.path.splitext(os.path.basename(src))[0]
    out = sys.argv[2] if len(sys.argv) > 2 else f"/tmp/{stem}.acro.json"

    from pypdf import PdfReader
    from pypdf.generic import IndirectObject
    import pdfplumber

    def deref(o):
        return o.get_object() if isinstance(o, IndirectObject) else o

    reader = PdfReader(src)

    def field_dict(widget):
        """Walk /Parent until we hit the dict carrying the field name (/T)."""
        cur = widget
        seen = set()
        while cur is not None and cur.get("/T") is None and "/Parent" in cur:
            nxt = deref(cur.get("/Parent"))
            if id(nxt) in seen:
                break
            seen.add(id(nxt))
            cur = nxt
        return cur

    def full_name(fd):
        parts = []
        cur = fd
        seen = set()
        while cur is not None and id(cur) not in seen:
            seen.add(id(cur))
            t = cur.get("/T")
            if t:
                parts.append(str(t))
            cur = deref(cur.get("/Parent")) if "/Parent" in cur else None
        return ".".join(reversed(parts)) or "(unnamed)"

    def inherited(widget, key):
        cur = widget
        seen = set()
        while cur is not None and id(cur) not in seen:
            seen.add(id(cur))
            if key in cur:
                return cur.get(key)
            cur = deref(cur.get("/Parent")) if "/Parent" in cur else None
        return None

    def on_states(widget):
        ap = deref(widget.get("/AP")) if "/AP" in widget else None
        if not ap:
            return []
        n = deref(ap.get("/N")) if "/N" in ap else None
        if not hasattr(n, "keys"):
            return []
        return [str(k) for k in n.keys() if str(k) != "/Off"]

    # field-name -> aggregate record (collects all kid widgets across pages)
    fields = {}
    pages_meta = []

    pdf = pdfplumber.open(src)
    for pi, page in enumerate(reader.pages):
        plp = pdf.pages[pi]
        H = float(plp.height)
        W = float(plp.width)
        pages_meta.append({"index": pi, "width": round(W, 2), "height": round(H, 2)})
        words = plp.extract_words()

        def label_for(x0, y0, x1, y1, band=8, maxdx=260):
            """Words on the field's row ending left of it (PDF coords in)."""
            top = H - y1
            bottom = H - y0
            cy = (top + bottom) / 2
            picks = [w for w in words
                     if abs((w["top"] + w["bottom"]) / 2 - cy) < band
                     and w["x1"] <= x0 + 2 and x0 - w["x0"] < maxdx]
            picks.sort(key=lambda w: w["x0"])
            return " ".join(w["text"] for w in picks)[-80:]

        annots = deref(page.get("/Annots")) or []
        for a in annots:
            obj = deref(a)
            if obj.get("/Subtype") != "/Widget":
                continue
            r = obj.get("/Rect")
            if not r:
                continue
            xs = [float(r[0]), float(r[2])]
            ys = [float(r[1]), float(r[3])]
            x0, x1 = min(xs), max(xs)
            y0, y1 = min(ys), max(ys)

            fd = field_dict(obj)
            name = full_name(fd)
            ft = str(inherited(obj, "/FT") or "")
            rec = fields.setdefault(
                name, {"name": name, "ft": ft, "page": pi,
                       "label": "", "rect": None, "options": []}
            )
            if ft:
                rec["ft"] = ft

            if ft == "/Btn":
                states = on_states(obj)
                rec["options"].append({
                    "page": pi,
                    "on_state": states[0] if states else "/On",
                    "cx": round((x0 + x1) / 2, 1),
                    "cy": round((y0 + y1) / 2, 1),
                    "w": round(x1 - x0, 1),
                    "h": round(y1 - y0, 1),
                })
                if not rec["label"]:
                    rec["label"] = label_for(x0, y0, x1, y1)
            else:  # /Tx text, /Ch choice — stamp on the rect
                rec["rect"] = [round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)]
                rec["page"] = pi
                rec["label"] = label_for(x0, y0, x1, y1)

    # order options left→right (physical column) so callers can pick by column
    for rec in fields.values():
        rec["options"].sort(key=lambda o: (o["page"], o["cx"]))

    data = {"src": os.path.abspath(src), "pages": pages_meta,
            "fields": list(fields.values())}
    with open(out, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    texts = [r for r in data["fields"] if r["ft"] != "/Btn"]
    btns = [r for r in data["fields"] if r["ft"] == "/Btn"]
    print(f"src: {data['src']}")
    print(f"acroform: {len(data['fields'])} fields  "
          f"({len(texts)} text/choice, {len(btns)} button groups)")
    for r in texts:
        print(f"  TEXT  p{r['page']} {str(r['rect']):<28} «{r['label']}»")
    for r in btns:
        cols = " ".join(f"{o['on_state']}@{o['cx']}" for o in r["options"])
        print(f"  BTN   p{r['page']} «{r['label'][:40]}»  [{cols}]")
    print(f"\nacroform -> {out}")


if __name__ == "__main__":
    main()
