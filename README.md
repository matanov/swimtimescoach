# CL2 Best Times

A browser-only viewer that turns Hy-Tek `.cl2` (SDIF v3) swim meet results into a
best-times table: swimmers in rows, events in columns grouped by course. Click a time
to see every swim in that event. Print to PDF or export CSV.

No server, no build step, no data upload. Files are parsed in the browser.

## Use

Open `index.html` directly, or serve the folder:

```sh
npm run serve        # python3 -m http.server 8000 → http://localhost:8000
```

Then add `.cl2`, `.sd3`, or Hy-Tek results `.zip` files (drag and drop works).

## Develop

```sh
npm test                      # parser tests, Node 18+, no dependencies
python3 tests/gen_fixtures.py # regenerate synthetic fixtures
```

| Path | What it is |
|---|---|
| `index.html` | Page markup |
| `src/cl2.js` | SDIF v3 / CL2 parser (browser global `CL2`, or `require` in Node) |
| `src/app.js` | UI: file loading, swimmer picker, grid, detail dialog, print, CSV |
| `src/styles.css` | Styles, including light/dark theme and print layout |
| `vendor/jszip.min.js` | JSZip 3.10.1, for reading results `.zip` files |
| `tests/` | Node tests and synthetic fixtures |
| `docs/sdif-v3-notes.md` | Record layouts the parser relies on |

## Deploy

Pushing to `main` runs the tests and publishes the site to GitHub Pages
(see `.github/workflows/pages.yml`). Enable it once under
**Settings → Pages → Source: GitHub Actions**.

## Known limitations

- Fixtures are synthetic, built to the SDIF v3 spec; add real Hy-Tek exports to `tests/fixtures/` as they're verified.
- Swimmers are matched across meets by name; same-name swimmers are split only when their USS IDs differ. Spelling variations between meets produce two rows.
- Relays are ignored; only individual swims are shown.
