#!/usr/bin/env python3
"""Assemble le widget Hostinger : fragment HTML unique (style + balisage + script) avec model_spec.json injecté
comme repli codé en dur. À relancer après toute modification de model_spec.json ou des parties."""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
P = root / "widget" / "parts"
spec = json.loads((root / "model_spec.json").read_text(encoding="utf-8"))
spec_js = json.dumps(spec, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
css = (P / "00_style.css").read_text(encoding="utf-8")
html = (P / "01_markup.html").read_text(encoding="utf-8")
js = "".join((P / f).read_text(encoding="utf-8") + "\n" for f in ["02_i18n.js", "03_core.js", "04_tabs1.js", "05_tabs2.js", "06_tabs3.js"])
# SPEC_FALLBACK doit exister avant le noyau
js = "const SPEC_FALLBACK = " + spec_js + ";\n" + js
out = ("<!-- Radar Macro FIRE : widget autonome pour module HTML Hostinger. Voir DEPLOIEMENT.md -->\n<style>\n" + css + "</style>\n" + html + "<script>\n(function(){\n'use strict';\n" + js + "})();\n</script>\n")
(root / "radar-macro-fire.html").write_text(out, encoding="utf-8")
print("widget:", len(out), "octets")
