#!/usr/bin/env python3
"""
Presight-styled test report generator.

Reads report_data.json, computes the charts from the data, and writes a single
self-contained HTML file. The logo and every chart are embedded, so the output
can be emailed or opened offline with no external dependencies.

Usage:
    python3 generate_report.py
    python3 generate_report.py --data my_data.json --out my_report.html

Only report_data.json normally needs editing. Pass rate, defect pie charts and
coverage bars are all derived from it — there are no numbers to keep in sync
by hand.
"""

from __future__ import annotations

import argparse
import base64
import collections
import html
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Category colours. Unknown categories fall back to the cycle below, so adding
# a new category to the data does not require touching this file.
CATEGORY_COLOURS = {
    "Data accuracy": "#0a85e0",
    "Data completeness": "#00a08a",
    "UI / formatting": "#6ec56a",
    "Content / wording": "#8b7cf6",
    "Performance": "#f59e0b",
    "Security": "#fb7185",
}
FALLBACK_COLOURS = ["#38bdf8", "#34d399", "#a78bfa", "#fbbf24", "#fb7185", "#22d3ee"]

STATUS_COLOURS = {
    "closed": "#00a08a",
    "open": "#fb7185",
    "reopened": "#f59e0b",
    "in progress": "#fbbf24",
    "deferred": "#94a3b8",
}


# ---------------------------------------------------------------------------
# Charts
# ---------------------------------------------------------------------------

def donut_slices(pairs, cx=60, cy=60, r=46, inner=24):
    """Build SVG path data for a donut chart. pairs = [(label, value, colour)]."""
    total = sum(v for _, v, _ in pairs)
    if total == 0:
        return []
    out, angle = [], -90.0
    for label, value, colour in pairs:
        sweep = value / total * 360
        # A full circle cannot be drawn as a single arc; nudge it closed.
        sweep = min(sweep, 359.99)
        a0, a1 = math.radians(angle), math.radians(angle + sweep)
        x0, y0 = cx + r * math.cos(a0), cy + r * math.sin(a0)
        x1, y1 = cx + r * math.cos(a1), cy + r * math.sin(a1)
        xi0, yi0 = cx + inner * math.cos(a0), cy + inner * math.sin(a0)
        xi1, yi1 = cx + inner * math.cos(a1), cy + inner * math.sin(a1)
        large = 1 if sweep > 180 else 0
        d = (f"M {x0:.2f} {y0:.2f} A {r} {r} 0 {large} 1 {x1:.2f} {y1:.2f} "
             f"L {xi1:.2f} {yi1:.2f} A {inner} {inner} 0 {large} 0 {xi0:.2f} {yi0:.2f} Z")
        out.append({"label": label, "value": value, "colour": colour,
                    "d": d, "pct": round(value / total * 100, 1)})
        angle += sweep
    return out


def donut_html(slices, centre_value, centre_label):
    paths = "\n".join(
        f'          <path d="{s["d"]}" fill="{s["colour"]}" opacity=".92">'
        f'<title>{html.escape(str(s["label"]))}: {s["value"]} ({s["pct"]}%)</title></path>'
        for s in slices
    )
    legend = "\n".join(
        f'          <li><span class="sw" style="background:{s["colour"]}"></span>'
        f'{html.escape(str(s["label"]))}<b>{s["value"]}</b><i>{s["pct"]}%</i></li>'
        for s in slices
    )
    return f'''        <svg viewBox="0 0 120 120" width="150" height="150" role="img"
             aria-label="{html.escape(centre_label)}: {centre_value}">
{paths}
          <text x="60" y="58" text-anchor="middle" class="pie-n">{centre_value}</text>
          <text x="60" y="70" text-anchor="middle" class="pie-l">{html.escape(centre_label)}</text>
        </svg>
        <ul class="legend">
{legend}
        </ul>'''


def gauge_html(pass_rate):
    """Pass-rate ring. The brand gradient fills the passing arc."""
    circumference = 2 * math.pi * 52
    filled = circumference * pass_rate / 100
    return f'''      <figure class="gauge">
        <svg viewBox="0 0 120 120" width="170" height="170" role="img"
             aria-label="Pass rate {pass_rate}%">
          <defs>
            <linearGradient id="pg" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stop-color="#6ec56a"/><stop offset="34%" stop-color="#00a08a"/>
              <stop offset="68%" stop-color="#0a85e0"/><stop offset="100%" stop-color="#4f6bf0"/>
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--line)" stroke-width="13"/>
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--fail)" stroke-width="13"
                  transform="rotate(-90 60 60)"/>
          <circle cx="60" cy="60" r="52" fill="none" stroke="url(#pg)" stroke-width="13"
                  stroke-linecap="round" stroke-dasharray="{filled:.2f} {circumference:.2f}"
                  transform="rotate(-90 60 60)"/>
        </svg>
        <figcaption><span class="pct">{pass_rate}%</span><span class="lbl">Pass rate</span></figcaption>
      </figure>'''


# ---------------------------------------------------------------------------
# Sections
# ---------------------------------------------------------------------------

def coverage_bars(report_types, total):
    rows = []
    for rt in report_types:
        passed, failed = rt.get("passed", 0), rt.get("failed", 0)
        share_pass = passed / total * 100 if total else 0
        share_fail = failed / total * 100 if total else 0
        fig = f'{passed} passed'
        if failed:
            fig += f' · <span style="color:var(--fail)">{failed} failed</span>'
        if rt.get("note"):
            fig += f' · {html.escape(rt["note"])}'
        fail_span = (f'<span class="seg-fail" style="width:{share_fail:.1f}%"></span>'
                     if failed else '')
        rows.append(f'''        <div>
          <div class="bar-top"><span class="bar-name">{html.escape(rt["name"])}</span>
            <span class="bar-fig">{fig}</span></div>
          <div class="track"><span class="seg-pass" style="width:{share_pass:.1f}%"></span>{fail_span}</div>
        </div>''')
    return "\n".join(rows)


def defect_tables(defects):
    """Two tables: closed, then everything still outstanding."""
    def row(d):
        sev = d.get("severity", "")
        tag = ""
        if d["status"] == "reopened":
            tag = '<span class="tag t-fail">Reopened</span>'
        elif sev == "urgent":
            tag = '<span class="tag t-fail">Urgent</span>'
        elif d["status"] != "closed":
            tag = f'<span class="tag t-warn">{html.escape(d["status"].title())}</span>'
        return (f'          <tr><td class="num">{html.escape(d["id"])}</td>'
                f'<td>{html.escape(d.get("area", ""))}</td>'
                f'<td>{d.get("finding", "")}</td>'
                f'<td>{tag}</td></tr>')

    closed = [d for d in defects if d["status"] == "closed"]
    outstanding = [d for d in defects if d["status"] != "closed"]

    def table(title, rows):
        if not rows:
            return ""
        body = "\n".join(row(d) for d in rows)
        return f'''    <div class="card">
      <h3 style="margin-top:0">{title}</h3>
      <table>
        <thead><tr><th>ID</th><th>Area</th><th>Finding</th><th>Status</th></tr></thead>
        <tbody>
{body}
        </tbody>
      </table>
    </div>'''

    return (table(f"Closed after validation ({len(closed)})", closed)
            + "\n" + table(f"Outstanding ({len(outstanding)})", outstanding))


def render_blocks(blocks):
    out = []
    for b in blocks:
        kind = b.get("type")
        if kind == "para":
            out.append(f'      <p style="margin-top:0;font-size:13.5px;color:var(--ink-2)">{b["text"]}</p>')
        elif kind == "heading":
            out.append(f'      <h3>{html.escape(b["text"])}</h3>')
        elif kind == "list":
            items = "\n".join(f'        <li>{i}</li>' for i in b["items"])
            out.append(f'      <ul class="read">\n{items}\n      </ul>')
        elif kind == "callout":
            cls = "callout risk" if b.get("variant") == "risk" else "callout"
            out.append(f'      <div class="{cls}">{b["text"]}</div>')
        elif kind == "table":
            head = "".join(f'<th>{html.escape(h)}</th>' for h in b["headers"])
            body = "\n".join(
                "          <tr>" + "".join(f'<td>{c}</td>' for c in r) + "</tr>"
                for r in b["rows"])
            out.append(f'''      <table>
        <thead><tr>{head}</tr></thead>
        <tbody>
{body}
        </tbody>
      </table>''')
        else:
            raise ValueError(f"unknown block type: {kind!r}")
    return "\n".join(out)


def render_sections(sections, start_number):
    out = []
    for i, s in enumerate(sections, start=start_number):
        lead = (f'    <p class="lead">{s["lead"]}</p>' if s.get("lead") else "")
        out.append(f'''  <section>
    <h2>{i}. {html.escape(s["title"])}</h2>
{lead}
    <div class="card">
{render_blocks(s["blocks"])}
    </div>
  </section>''')
    return "\n\n".join(out)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def build(data: dict, logo_b64: str, template: str) -> str:
    meta = data["meta"]
    types = data["report_types"]
    defects = data.get("defects", [])

    total = sum(t.get("passed", 0) + t.get("failed", 0) for t in types)
    passed = sum(t.get("passed", 0) for t in types)
    failed = total - passed
    pass_rate = round(passed / total * 100, 1) if total else 0.0

    urgent = sum(1 for d in defects if d.get("severity") == "urgent")
    open_defects = sum(1 for d in defects if d["status"] != "closed")

    # Charts derived from the defect list — nothing to maintain separately.
    cat_counts = collections.Counter(d["category"] for d in defects)
    fallback = iter(FALLBACK_COLOURS * 4)
    cat_pairs = [(k, v, CATEGORY_COLOURS.get(k) or next(fallback))
                 for k, v in cat_counts.most_common()]

    status_counts = collections.Counter(d["status"] for d in defects)
    order = [s for s in ("closed", "open", "in progress", "reopened", "deferred")
             if status_counts.get(s)]
    order += [s for s in status_counts if s not in order]
    status_pairs = [(s, status_counts[s], STATUS_COLOURS.get(s, "#94a3b8")) for s in order]

    defect_section = ""
    if defects:
        defect_section = f'''  <section>
    <h2>2. Defect profile</h2>
    <p class="lead">{len(defects)} defects handled in the period.</p>
    <div class="charts">
      <div class="card">
        <h3 style="margin-top:0">By category</h3>
        <div class="chart">
{donut_html(donut_slices(cat_pairs), len(defects), "defects")}
        </div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">By status</h3>
        <div class="chart">
{donut_html(donut_slices(status_pairs), len(defects), "defects")}
        </div>
      </div>
    </div>
{f'    <div class="callout">{data["defect_callout"]}</div>' if data.get("defect_callout") else ""}
  </section>'''

    repl = {
        "__LOGO__": "data:image/png;base64," + logo_b64,
        "__TITLE__": html.escape(meta["title"]),
        "__DOC_TYPE__": html.escape(meta.get("doc_type", "Test Report")),
        "__PERIOD__": html.escape(meta.get("period", "")),
        "__ENV__": html.escape(meta.get("environment", "")),
        "__PREPARED_BY__": html.escape(meta.get("prepared_by", "")),
        "__STATUS__": html.escape(meta.get("status", "")),
        "__FOOTER__": html.escape(meta.get("footer_note", "")),
        "__GAUGE__": gauge_html(pass_rate),
        "__TOTAL__": str(total),
        "__PASSED__": str(passed),
        "__URGENT__": str(urgent if urgent else failed),
        "__URGENT_LABEL__": "Urgent defect" if urgent == 1 else ("Urgent defects" if urgent else "Failed"),
        "__OPEN__": str(open_defects),
        "__SUMMARY_CALLOUT__": (f'<div class="callout">{data["summary_callout"]}</div>'
                                if data.get("summary_callout") else ""),
        "__DEFECT_SECTION__": defect_section,
        "__COVERAGE_BARS__": coverage_bars(types, total),
        "__DEFECT_TABLES__": defect_tables(defects),
        "__SECTIONS__": render_sections(data.get("sections", []), start_number=5),
    }
    out = template
    for k, v in repl.items():
        out = out.replace(k, v)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(HERE / "report_data.json"))
    ap.add_argument("--template", default=str(HERE / "template.html"))
    ap.add_argument("--logo", default=str(HERE / "assets" / "presight-logo.png"))
    ap.add_argument("--out", default=str(HERE / "test-report.html"))
    args = ap.parse_args()

    for path in (args.data, args.template, args.logo):
        if not Path(path).exists():
            sys.exit(f"not found: {path}")

    data = json.loads(Path(args.data).read_text(encoding="utf-8"))
    template = Path(args.template).read_text(encoding="utf-8")
    logo_b64 = base64.b64encode(Path(args.logo).read_bytes()).decode()

    out_path = Path(args.out)
    out_path.write_text(build(data, logo_b64, template), encoding="utf-8")

    total = sum(t.get("passed", 0) + t.get("failed", 0) for t in data["report_types"])
    passed = sum(t.get("passed", 0) for t in data["report_types"])
    rate = round(passed / total * 100, 1) if total else 0
    print(f"wrote {out_path}")
    print(f"  {total} instances · {passed} passed · {rate}% pass rate"
          f" · {len(data.get('defects', []))} defects")


if __name__ == "__main__":
    main()
