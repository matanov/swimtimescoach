# CLAUDE.md

Context for Claude Code working in this repo.

## Project
Static, dependency-free web app that parses Hy-Tek `.cl2` / USA Swimming SDIF v3
files in the browser and shows a best-times table (swimmers = rows, events = columns,
grouped by course SCY/SCM/LCM). Users load many meet files, pick swimmers, click a
cell to see all swims for that event, and print to PDF or download CSV.

## Constraints
- No build step, no framework, no npm runtime dependencies. Plain ES2020 scripts loaded by `index.html`.
- Everything runs client-side; never send result data anywhere. The CSP meta in `index.html` enforces this (`connect-src 'none'`, own files only): don't loosen it, add external resources, or store result data in browser storage.
- Third-party code and fonts are vendored in `vendor/` (JSZip 3.10.1, Barlow fonts), not loaded from a CDN.
- `src/cl2.js` and `src/session.js` must stay usable from both the browser (`window.CL2`, `window.Session`) and Node (`require`) so tests can run without a DOM.

## Commands
- `npm test` — parser tests (`node --test`)
- `npm run serve` — local server on 127.0.0.1:8000 (localhost only)
- `python3 tests/gen_fixtures.py` — regenerate synthetic fixtures
- `npm run build-share` — build git-ignored `src/share-template.js`, `swimtimescoach.html` and `demo.html` (sample team from `docs/sample-data/`) (CI does this before deploy; "Share as file" and the download link need them locally)
- `npm run anonymize -- <folder>` — anonymize real `.cl2` files into git-ignored `tests/fixtures-private/`

## Real data
- Never open, print or commit real `.cl2` files or `~/swim-private/cl2-mapping.json`; they contain children's names, birth dates and IDs. Work from `tests/fixtures-private/` (anonymized) or synthetic fixtures.
- `tools/anonymize.js` is an allowlist: a field not listed in `KEEP` is blanked, and unknown record types stop the run. To support a new record type, add its fields from the SDIF spec and a test in `tests/anonymize.test.js`.

## Parser notes
- Records are fixed-width, 160 chars; the record code is columns 1–2. Lines may be short (trailing spaces stripped) and are padded before slicing.
- Field helper `f(line, start, len)` uses the spec's 1-based start/length. Keep that convention so positions can be checked against `docs/sdif-v3-notes.md`.
- A D0 creates up to three swims (prelim, swim-off, final). Each time has its own course code; `X` means DQ.
- D3 follows only the first D0 for a swimmer in a file, so swimmers are shared per file to propagate the preferred name and 14-char USS ID.
- D0s with no distance/stroke are relay-only swimmer entries and are skipped.
- Best time = fastest swim with a valid time; DQ/NS/SCR/DNF never count.
- Never pick a "best" across courses: yards and meters times aren't comparable. The event view (`courseBests`) keeps one best per course.
- Meets are never merged by name; `labelMeets` gives same-name meets distinct labels. Show `meet.label` (or `datedLabel` next to a date), not `meet.name`.
- Saved sessions store the raw file texts, not parsed data, and are re-parsed on open. Bump `VERSION` in `src/session.js` only if `session.json` changes incompatibly.
- Cross-file logic (`assignPeople`, `bestOf`, `labelMeets`) lives in `src/cl2.js` so it is testable in Node; `src/app.js` is DOM only.

## Share as file
- `tools/build-share.js` inlines index.html, styles, fonts and scripts into one template; it fails loudly if the index.html snippets it replaces change. App scripts must not contain `<!--` (breaks inline script parsing); `</script` is escaped automatically.
- `swimtimescoach.html` (downloadable app) is the template unfilled; app.js detects that (`isDownloadedApp`) and captures its own page as the share template before changing the DOM. Elements marked `data-site-only` in index.html (links to site files) are stripped from it.
- A shared file must contain only the selected swimmers: data goes through `trimToSwimmers`, and `shareFile` re-renders before copying the static table and swim list.

## Docs
- README screenshots (`docs/images/`) show only the synthetic team from `python3 tools/make_sample_data.py` (`docs/sample-data/`), never real or anonymized-real data: anonymized files keep real times, which can be matched to public results.
- The in-app help (`#help` dialog in `index.html`) and the README user guide say the same things; update both when behavior changes.

## Testing changes
- Add a fixture or extend `tests/gen_fixtures.py` for any parser change, then add a test in `tests/parser.test.js`.
- For UI changes, check the print preview (landscape) as well as the screen layout, in both light and dark mode.
- Browser checks must work under the CSP: no inline scripts, so drive the page from an external script file on the same origin (e.g. in git-ignored `tests/fixtures-private/`).
