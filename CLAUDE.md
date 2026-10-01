# CLAUDE.md

Context for Claude Code working in this repo.

## Project
Static, dependency-free web app that parses Hy-Tek `.cl2` / USA Swimming SDIF v3
files in the browser and shows a best-times table (swimmers = rows, events = columns,
grouped by course SCY/SCM/LCM). Users load many meet files, pick swimmers, click a
cell to see all swims for that event, and print to PDF or download CSV.

## Constraints
- No build step, no framework, no npm runtime dependencies. Plain ES2020 scripts loaded by `index.html`.
- Everything runs client-side; never send result data anywhere.
- Third-party code is vendored in `vendor/` (currently JSZip 3.10.1), not loaded from a CDN.
- `src/cl2.js` must stay usable from both the browser (`window.CL2`) and Node (`require`) so tests can run without a DOM.

## Commands
- `npm test` — parser tests (`node --test`)
- `npm run serve` — local server on :8000
- `python3 tests/gen_fixtures.py` — regenerate synthetic fixtures

## Parser notes
- Records are fixed-width, 160 chars; the record code is columns 1–2. Lines may be short (trailing spaces stripped) and are padded before slicing.
- Field helper `f(line, start, len)` uses the spec's 1-based start/length. Keep that convention so positions can be checked against `docs/sdif-v3-notes.md`.
- A D0 creates up to three swims (prelim, swim-off, final). Each time has its own course code; `X` means DQ.
- D3 follows only the first D0 for a swimmer in a file, so swimmers are shared per file to propagate the preferred name and 14-char USS ID.
- D0s with no distance/stroke are relay-only swimmer entries and are skipped.
- Best time = fastest swim with a valid time; DQ/NS/SCR/DNF never count.

## Testing changes
- Add a fixture or extend `tests/gen_fixtures.py` for any parser change, then add a test in `tests/parser.test.js`.
- For UI changes, check the print preview (landscape) as well as the screen layout, in both light and dark mode.
