#!/usr/bin/env python3
from __future__ import annotations

import html
import re
from pathlib import Path
from xml.etree import ElementTree as ET


PROJECT_DIR = Path(__file__).resolve().parent.parent
TEI_PATH = PROJECT_DIR / "data" / "Presbyterologia.xml"
EXPORT_DIR = PROJECT_DIR / "exports"

TITLE = "Presbyterologia Norwegico Wos-Hardangriana"
AUTHOR = "Gert Henriksson Miltzow"
TRANSLATOR = "Simen Johansen"
LANG = "nb"


def local_name(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def normalize_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def render_inline(node: ET.Element) -> str:
    parts: list[str] = []

    if node.text:
        parts.append(html.escape(node.text))

    for child in list(node):
        name = local_name(child.tag)
        inner = render_inline(child)
        if name == "hi":
            rend = child.attrib.get("rend", "")
            if rend == "bold":
                parts.append(f"<strong>{inner}</strong>")
            elif rend == "italic":
                parts.append(f"<em>{inner}</em>")
            else:
                parts.append(f"<span>{inner}</span>")
        elif name == "head":
            parts.append(f"<span class=\"head-inline\">{inner}</span>")
        elif name == "quote":
            parts.append(f"<span class=\"quote-inline\">{inner}</span>")
        elif name == "bibl":
            parts.append(f"<span class=\"bibl-inline\">{inner}</span>")
        elif name == "byline":
            parts.append(f"<span class=\"byline-inline\">{inner}</span>")
        elif name == "lb":
            parts.append("<br />")
        else:
            parts.append(inner)

        if child.tail:
            parts.append(html.escape(child.tail))

    return "".join(parts)


def get_head_info(seg: ET.Element) -> tuple[bool, int, str]:
    for child in list(seg):
        if local_name(child.tag) == "head":
            n = child.attrib.get("n", "1")
            try:
                level = max(1, min(3, int(n)))
            except ValueError:
                level = 1
            text = normalize_ws("".join(child.itertext()))
            return True, level, text
    return False, 1, ""


def build_entries(root: ET.Element) -> list[dict]:
    body = None
    for el in root.iter():
        if local_name(el.tag) == "body":
            body = el
            break
    if body is None:
        body = root

    entries: list[dict] = []
    entries_by_id: dict[str, dict] = {}
    current_entry: dict | None = None

    def walk(node: ET.Element, in_margin_note: bool = False) -> None:
        nonlocal current_entry
        for child in list(node):
            name = local_name(child.tag)
            child_in_margin = in_margin_note or (
                name == "note" and child.attrib.get("place") == "margin"
            )

            if name == "seg" and not child_in_margin:
                lang = child.attrib.get("{http://www.w3.org/XML/1998/namespace}lang")
                if lang == "la":
                    seg_id = child.attrib.get("{http://www.w3.org/XML/1998/namespace}id")
                    has_head, head_level, head_text = get_head_info(child)
                    entry_id = seg_id or f"auto-{len(entries) + 1}"
                    item = {
                        "id": entry_id,
                        "la_html": normalize_ws(render_inline(child)),
                        "no_html": [],
                        "is_head": has_head,
                        "head_level": head_level,
                        "head_text": head_text,
                    }
                    entries.append(item)
                    entries_by_id[entry_id] = item
                    current_entry = item
                elif lang == "no":
                    corresp = (child.attrib.get("corresp") or "").replace("#", "")
                    target = entries_by_id.get(corresp) if corresp else current_entry
                    if target is not None:
                        target["no_html"].append(normalize_ws(render_inline(child)))
                continue

            walk(child, child_in_margin)

    walk(body)
    return entries


def build_toc(entries: list[dict]) -> list[tuple[str, int, str]]:
    toc: list[tuple[str, int, str]] = []
    for e in entries:
        if e["is_head"]:
            title = e["head_text"] or re.sub(r"<[^>]+>", "", e["la_html"])
            toc.append((e["id"], e["head_level"], normalize_ws(title)))
    return toc


def export_html(entries: list[dict], toc: list[tuple[str, int, str]]) -> None:
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    out = EXPORT_DIR / "presbyterologia.html"
    toc_items = []
    for entry_id, level, title in toc:
        safe = html.escape(title)
        toc_items.append(f'<a class="toc-item l{level}" href="#{entry_id}">{safe}</a>')

    body_entries = []
    for e in entries:
        cls = f"entry head-l{e['head_level']}" if e["is_head"] else "entry"
        no_html = " ".join(e["no_html"]).strip()
        body_entries.append(
            f"""
            <article id="{e['id']}" class="{cls}">
              <div class="la">{e['la_html']}</div>
              <div class="no">{no_html}</div>
            </article>
            """.strip()
        )

    html_doc = f"""<!doctype html>
<html lang="nb">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{html.escape(TITLE)}</title>
  <style>
    body {{ font-family: Georgia, 'Times New Roman', serif; margin: 2rem; line-height: 1.5; }}
    h1 {{ margin-bottom: 0.2rem; }}
    .meta {{ color: #555; margin-bottom: 1.5rem; }}
    .layout {{ display: grid; grid-template-columns: 260px 1fr; gap: 1.2rem; align-items: start; }}
    .toc {{ position: sticky; top: 1rem; border: 1px solid #ddd; border-radius: 8px; padding: 0.8rem; max-height: 85vh; overflow: auto; }}
    .toc h2 {{ margin-top: 0; font-size: 1.1rem; }}
    .toc-item {{ display: block; color: #40263e; text-decoration: none; margin: 0.25rem 0; }}
    .toc-item.l2 {{ margin-left: 0.7rem; }}
    .toc-item.l3 {{ margin-left: 1.4rem; }}
    .entry {{ display: grid; grid-template-columns: 1fr 1fr; gap: 1.2rem; margin: 0.35rem 0; }}
    .entry .la {{ font-size: 1.06rem; }}
    .entry .no {{ font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }}
    .entry.head-l1 .la, .entry.head-l1 .no {{ color: #40263e; font-weight: 700; font-size: 1.18rem; margin-top: 0.7rem; }}
    .entry.head-l2 .la, .entry.head-l2 .no {{ color: #40263e; font-weight: 650; font-size: 1.08rem; margin-top: 0.5rem; }}
    .entry.head-l3 .la, .entry.head-l3 .no {{ color: #40263e; font-weight: 600; font-size: 1.02rem; margin-top: 0.35rem; }}
    .quote-inline {{ font-style: italic; }}
    .byline-inline {{ font-weight: 650; }}
    .bibl-inline {{ font-size: 0.96em; }}
    @media (max-width: 900px) {{
      .layout {{ grid-template-columns: 1fr; }}
      .entry {{ grid-template-columns: 1fr; }}
      .toc {{ position: static; max-height: none; }}
    }}
  </style>
</head>
<body>
  <h1>{html.escape(TITLE)}</h1>
  <div class="meta">{html.escape(AUTHOR)} · 1679 · Oversettelse: {html.escape(TRANSLATOR)}</div>
  <div class="layout">
    <aside class="toc">
      <h2>Innhold</h2>
      {''.join(toc_items)}
    </aside>
    <main>
      {''.join(body_entries)}
    </main>
  </div>
</body>
</html>"""
    out.write_text(html_doc, encoding="utf-8")


def main() -> None:
    root = ET.parse(TEI_PATH).getroot()
    entries = build_entries(root)
    toc = build_toc(entries)
    export_html(entries, toc)
    print(f"Wrote: {EXPORT_DIR / 'presbyterologia.html'}")


if __name__ == "__main__":
    main()
