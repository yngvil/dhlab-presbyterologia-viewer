# Presbyterologia Viewer

Statisk TEI-visning med parallell latin/norsk tekst, marginalia og lenker til faksimiler.

## Struktur

- `index.html` – inngangsside (kreves for GitHub Pages)
- `src/app.js` – parser og rendering
- `src/styles.css` – layout og stil
- `data/Presbyterologia.xml` – standard TEI-kilde
- `assets/` – logo og statiske ressurser
- `exports/` – nedlastbare eksportfiler (HTML)
- `tools/generate_exports.py` – bygger eksportfiler fra TEI

## Bruk (serverlos)

1. Apne `index.html`.
2. For lokal fil: klikk `Velg TEI-fil` og velg en XML.
3. For standard fil: visningen laster `data/Presbyterologia.xml` automatisk nar den kjorer fra server.

## Eksport

Regenerer nedlastbar HTML:

```bash
cd "/Users/yngvilb/Documents/New project/presbyterologia-viewer"
python3 tools/generate_exports.py
```

Dette skriver:

- `exports/presbyterologia.html`
