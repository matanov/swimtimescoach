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

### Views

**By course** (default) has a column per event per course, grouped under
SCY, SCM and LCM. **By event (SC + LC)** has one column per event; each cell
stacks the swimmer's short-course best over their long-course best, marked
with Hy-Tek's course letters (`24.51Y`, `26.40S`, `27.80L`). A course with
no swims shows `—SC` or `—LC`; an event with no swims at all is blank.
Yards and meters times are never compared, so a swimmer with both SCY and
SCM swims gets both. 500/1000/1650 yards free share a column with
400/800/1500 meters; the header names only the distances actually swum
("400 Free" for a meters-only team, "400/500 Free" when both appear). Click any cell for every swim in that event, best
marked per course. Print and CSV follow the current view.

### Saving your work

**Save session** downloads one `.zip` with every loaded meet file plus your
swimmer selection and print option. Reopen it later with **Open session** (or
drop it on the page) to pick up where you left off. It's an ordinary zip: unzip
it to get the original `.cl2` files back. Nothing is stored in the browser or
sent anywhere; the session file is the only copy.

## Develop

```sh
npm test                      # parser tests, Node 18+, no dependencies
python3 tests/gen_fixtures.py # regenerate synthetic fixtures
```

### Testing with real meet files

Real results contain children's names, birth dates and IDs, so they are
anonymized locally first and never committed:

```sh
npm run anonymize -- ~/path/to/real-cl2-folder          # one team in the files
npm run anonymize -- ~/path/to/folder --list-teams      # several teams: see codes (run it yourself)
npm run anonymize -- ~/path/to/folder --our-team CODE   # ...then pick yours
```

Swimmers get mixed movie-star names, our team becomes Chicken Cats, other
teams and meets get fake names, and USS IDs and birth dates are replaced. The
same swimmer gets the same fake name in every file and on every run, via a
mapping kept at `~/swim-private/cl2-mapping.json` (`--map` to change; it must
be outside the repo, since it holds the real names). Output goes to the
git-ignored `tests/fixtures-private/`, where `npm test` picks it up.
Before writing anything, the script checks that no real name, ID, team or meet
appears in the output, and that the app parses every swim identically.

| Path | What it is |
|---|---|
| `index.html` | Page markup |
| `src/cl2.js` | SDIF v3 / CL2 parser, plus swimmer matching, best times and meet labels (browser global `CL2`, or `require` in Node) |
| `src/app.js` | UI: file loading, swimmer picker, grid, detail dialog, print, CSV, sessions |
| `src/session.js` | Save/open a session `.zip` (meet files + `session.json`) |
| `src/styles.css` | Styles, including light/dark theme and print layout |
| `vendor/jszip.min.js` | JSZip 3.10.1, for reading results `.zip` files |
| `vendor/fonts/` | Barlow and Barlow Condensed (latin, SIL OFL), so no font CDN is contacted |
| `tests/` | Node tests and synthetic fixtures |
| `tools/anonymize.js` | Turns real `.cl2` files into anonymized local test fixtures |
| `docs/sdif-v3-notes.md` | Record layouts the parser relies on |

## Known limitations

- Fixtures are synthetic, built to the SDIF v3 spec; add real Hy-Tek exports to `tests/fixtures/` as they're verified.
- Swimmers are matched across meets by name; same-name swimmers are split only when their USS IDs differ. Spelling variations between meets produce two rows.
- Relays are ignored; only individual swims are shown.
- Meets with the same name stay separate. They are labelled with the year, then the date, city, or file name, whichever tells them apart.
