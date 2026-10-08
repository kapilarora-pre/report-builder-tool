#!/usr/bin/env python3
"""
Rebuild report-builder.html from its sources.

The builder page embeds the report template, the logo and the sample data so it
works as a single file with no server. Run this after changing template.html,
builder_shell.html or builder_app.js.
"""
import base64
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

payload = {
    "template": (HERE / "template.html").read_text(encoding="utf-8"),
    "logo": base64.b64encode((HERE / "assets" / "presight-logo.png").read_bytes()).decode(),
    "sample": json.loads((HERE / "report_data.json").read_text(encoding="utf-8")),
}

out = (HERE / "builder_shell.html").read_text(encoding="utf-8") \
    .replace("__PAYLOAD__", json.dumps(payload, ensure_ascii=False)) \
    .replace("__APP__", (HERE / "builder_app.js").read_text(encoding="utf-8"))

target = HERE / "report-builder.html"
target.write_text(out, encoding="utf-8")
print(f"wrote {target}  ({len(out) / 1024:.1f} KB)")
