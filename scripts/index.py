#!/usr/bin/env python3
import html
import json
import sys
from urllib.parse import quote

STYLE = "body{font:14px system-ui;margin:2rem;max-width:48rem}h2{margin-top:1.5rem}a{display:block;padding:.2rem 0}"

name = sys.argv[1]
targets = {}
for key in json.load(sys.stdin):
    target, _, rest = key.partition("/")
    if rest and "/" not in rest:
        targets.setdefault(target, []).append(rest)

print(f"<!doctype html><meta charset=utf-8><title>{html.escape(name)} build</title>")
print(f"<style>{STYLE}</style>")
print(f"<h1>{html.escape(name)} build</h1>")
for target in sorted(targets):
    print(f"<h2>{html.escape(target)}</h2>")
    for f in sorted(targets[target]):
        rel = f"{target}/{f}"
        print(f'<a href="{quote(rel)}">{html.escape(rel)}</a>')
