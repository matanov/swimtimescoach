"""Build standards/efsl-2025-2028.json from the EFSL championship qualification
times (EFSL Champs Cut Times (2025-2028).pdf, 4 pages).

The rows below are the PDF's text exactly as printed. The PDF leaves cells
blank where an age group doesn't swim an event, and its text drops those
blanks, so COLUMNS says which events each age group's times belong to (checked
against the page images). Every row must have exactly that many times.

Also writes src/standards-efsl.js, the same data as a script: the app's CSP
stops it from fetching JSON, so it loads standards like its other scripts.

Run: python3 tools/make_efsl_standards.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "standards" / "efsl-2025-2028.json"
JS = ROOT / "src" / "standards-efsl.js"
AGE_GROUPS = [("8&U", None, 8), ("9", 9, 9), ("10", 10, 10), ("11", 11, 11), ("12", 12, 12),
              ("13", 13, 13), ("14", 14, 14), ("15-16", 15, 16), ("17-19", 17, 19)]
YOUNG, MID, OLD = ["8&U", "9", "10"], ["11", "12"], ["13", "14", "15-16", "17-19"]

# championship -> course -> (all events in printed column order, {age groups: events they swim})
COLUMNS = {
    "long-distance": {
        "SCM": (["100 Back", "100 Breast", "100 Fly", "200 Back", "200 Breast", "200 Fly", "400 Free", "800 Free", "1500 Free", "200 IM", "400 IM"],
                {tuple(YOUNG): ["100 Back", "100 Breast", "100 Fly", "400 Free", "800 Free", "200 IM"],
                 tuple(MID):   ["100 Back", "100 Breast", "100 Fly", "400 Free", "800 Free", "1500 Free", "400 IM"],
                 tuple(OLD):   ["200 Back", "200 Breast", "200 Fly", "800 Free", "1500 Free", "400 IM"]}),
    },
    "short-distance": {
        "SCM": (["50 Back", "50 Breast", "50 Fly", "100 Back", "100 Breast", "100 Fly", "50 Free", "100 Free", "200 Free", "400 Free", "100 IM", "200 IM"],
                {tuple(YOUNG): ["50 Back", "50 Breast", "50 Fly", "50 Free", "100 Free", "200 Free", "100 IM"],
                 tuple(MID):   ["50 Back", "50 Breast", "50 Fly", "50 Free", "100 Free", "200 Free", "100 IM", "200 IM"],
                 tuple(OLD):   ["100 Back", "100 Breast", "100 Fly", "50 Free", "100 Free", "200 Free", "400 Free", "200 IM"]}),
        # the LCM page has no 100 IM column, and ages 10 and under have no 200 IM
        "LCM": (["50 Back", "50 Breast", "50 Fly", "100 Back", "100 Breast", "100 Fly", "50 Free", "100 Free", "200 Free", "400 Free", "200 IM"],
                {tuple(YOUNG): ["50 Back", "50 Breast", "50 Fly", "50 Free", "100 Free", "200 Free"],
                 tuple(MID):   ["50 Back", "50 Breast", "50 Fly", "50 Free", "100 Free", "200 Free", "200 IM"],
                 tuple(OLD):   ["100 Back", "100 Breast", "100 Fly", "50 Free", "100 Free", "200 Free", "400 Free", "200 IM"]}),
    },
}
COLUMNS["long-distance"]["LCM"] = COLUMNS["long-distance"]["SCM"]   # same layout on both pages

# As printed: one "age sex times..." line per row (F = Girls, M = Boys)
PRINTED = {
("long-distance", "SCM"): """
8&U F 1:59.22 2:15.58 2:10.13 7:44.50 16:02.95 4:47.66
8&U M 1:54.31 2:10.72 2:07.21 7:32.94 15:57.12 4:42.24
9 F 1:57.01 2:13.07 2:07.72 7:35.90 15:44.07 4:21.51
9 M 1:52.19 2:08.30 2:04.86 7:24.55 15:38.36 4:16.58
10 F 1:50.39 2:05.54 2:00.49 7:10.09 15:25.56 3:53.49
10 M 1:45.84 2:01.04 1:57.79 6:59.39 15:19.96 3:49.09
11 F 1:40.19 1:50.79 1:40.29 6:37.29 13:46.39 26:35.29 7:35.39
11 M 1:39.19 1:50.79 1:39.99 6:30.49 13:41.39 26:22.59 7:23.69
12 F 1:35.69 1:46.59 1:35.09 6:22.69 13:09.89 24:58.39 7:13.49
12 M 1:30.79 1:42.29 1:31.59 6:07.49 12:53.09 24:19.79 6:56.99
13 F 3:08.89 3:36.49 3:14.79 12:46.39 24:07.99 6:53.39
13 M 2:59.19 3:22.19 3:02.59 12:01.79 22:59.09 6:29.89
14 F 3:05.49 3:31.09 3:09.39 12:25.59 23:36.69 6:44.59
14 M 2:51.49 3:13.69 2:53.29 11:41.29 22:15.29 6:13.19
15-16 F 3:02.19 3:27.89 3:05.89 12:14.89 23:32.39 6:40.89
15-16 M 2:47.69 3:09.49 2:50.09 11:25.69 21:39.79 6:06.39
17-19 F 2:58.59 3:26.39 3:02.39 12:07.09 23:07.39 6:31.29
17-19 M 2:41.39 3:01.49 2:44.39 11:13.19 21:17.49 5:55.79
""",
("long-distance", "LCM"): """
8&U F 2:04.50 2:22.24 2:14.54 8:01.25 16:51.76 4:59.01
8&U M 1:59.45 2:16.32 2:10.92 7:50.95 16:26.61 4:52.01
9 F 2:02.19 2:19.60 2:12.05 7:52.34 16:31.92 4:31.82
9 M 1:57.24 2:13.79 2:08.50 7:42.23 16:07.27 4:25.47
10 F 1:55.28 2:11.70 2:04.58 7:25.61 16:12.47 4:02.70
10 M 1:50.60 2:06.22 2:01.23 7:16.07 15:48.30 3:57.02
11 F 1:45.79 1:55.89 1:43.39 6:48.69 14:28.29 27:57.39 7:55.89
11 M 1:44.69 1:57.19 1:43.49 6:41.79 14:06.69 27:24.39 7:46.59
12 F 1:40.59 1:50.39 1:38.39 6:32.89 13:42.39 26:13.99 7:28.89
12 M 1:37.19 1:47.79 1:35.09 6:21.19 13:22.49 25:51.79 7:17.89
13 F 3:19.79 3:45.79 3:21.29 13:05.99 25:08.99 7:09.89
13 M 3:09.79 3:33.39 3:08.89 12:31.29 23:58.89 6:46.69
14 F 3:13.99 3:40.79 3:16.79 12:46.09 24:32.59 6:58.49
14 M 3:01.99 3:23.89 3:00.09 12:04.89 23:11.39 6:31.39
15-16 F 3:09.89 3:36.79 3:10.89 12:27.79 23:51.99 6:53.99
15-16 M 2:56.19 3:19.89 2:55.69 11:44.59 22:38.89 6:24.19
17-19 F 3:08.69 3:33.09 3:06.49 12:21.29 23:33.89 6:44.79
17-19 M 2:51.59 3:12.19 2:49.59 11:29.19 22:02.49 6:12.19
""",
("short-distance", "SCM"): """
8&U F 0:58.09 1:10.27 1:02.02 0:48.07 1:57.09 3:48.64 2:15.32
8&U M 0:57.97 1:08.92 0:59.74 0:46.24 1:54.19 3:34.96 2:09.10
9 F 0:54.80 1:03.89 0:56.38 0:45.35 1:46.45 3:44.40 2:03.02
9 M 0:54.69 1:02.65 0:54.31 0:43.62 1:43.81 3:30.98 1:57.37
10 F 0:50.74 0:57.04 0:50.34 0:41.99 1:35.04 3:31.70 1:49.84
10 M 0:50.64 0:55.94 0:48.49 0:40.39 1:32.69 3:19.04 1:44.79
11 F 0:44.89 0:50.29 0:42.99 0:37.74 1:25.89 3:06.89 1:37.99 3:32.99
11 M 0:45.59 0:51.79 0:44.29 0:37.39 1:23.99 3:04.09 1:37.29 3:32.89
12 F 0:41.69 0:46.69 0:39.89 0:36.29 1:19.69 2:53.49 1:30.99 3:17.79
12 M 0:42.09 0:47.79 0:40.79 0:34.99 1:17.99 2:50.99 1:30.19 3:16.89
13 F 1:28.19 1:38.69 1:27.49 0:34.19 1:16.69 2:47.59 5:55.29 3:08.79
13 M 1:23.69 1:34.49 1:24.09 0:31.89 1:13.39 2:40.09 5:41.19 3:03.19
14 F 1:21.39 1:33.29 1:20.99 0:33.49 1:14.39 2:41.79 5:41.69 3:01.29
14 M 1:16.29 1:26.49 1:15.69 0:30.69 1:09.29 2:31.59 5:23.99 2:48.99
15-16 F 1:19.19 1:31.09 1:18.89 0:33.09 1:12.89 2:37.79 5:34.99 2:57.09
15-16 M 1:13.19 1:22.69 1:12.29 0:29.59 1:06.79 2:26.29 5:13.59 2:42.09
17-19 F 1:17.89 1:29.79 1:17.79 0:32.59 1:11.99 2:35.29 5:31.59 2:53.29
17-19 M 1:11.29 1:20.59 1:10.49 0:28.79 1:04.99 2:21.89 5:05.79 2:38.19
""",
("short-distance", "LCM"): """
8&U F 1:00.40 1:12.49 1:04.12 0:49.40 2:01.53 3:55.74
8&U M 0:59.92 1:11.01 1:00.79 0:47.93 1:58.10 3:42.71
9 F 0:56.98 1:05.90 0:58.29 0:46.60 1:50.48 3:51.38
9 M 0:56.53 1:04.55 0:55.26 0:45.21 1:47.36 3:38.59
10 F 0:52.76 0:58.84 0:52.05 0:43.15 1:38.64 3:38.28
10 M 0:52.34 0:57.64 0:49.34 0:41.86 1:35.86 3:26.22
11 F 0:46.79 0:52.29 0:43.59 0:38.99 1:29.19 3:12.99 3:40.59
11 M 0:47.59 0:53.39 0:45.29 0:38.53 1:27.79 3:09.79 3:40.69
12 F 0:43.49 0:48.59 0:40.49 0:37.33 1:22.79 2:59.19 3:24.89
12 M 0:43.99 0:49.19 0:41.59 0:36.13 1:21.49 2:56.19 3:24.09
13 F 1:32.69 1:42.19 1:30.59 0:35.39 1:19.59 2:53.49 6:04.79 3:15.79
13 M 1:29.59 1:39.59 1:27.29 0:33.09 1:16.19 2:46.39 5:53.99 3:09.59
14 F 1:25.99 1:37.29 1:23.49 0:34.69 1:16.89 2:47.59 5:52.09 3:07.89
14 M 1:21.09 1:30.29 1:18.09 0:31.79 1:12.59 2:37.89 5:34.19 2:56.79
15-16 F 1:23.59 1:35.09 1:21.19 0:34.19 1:15.39 2:42.99 5:42.49 3:03.29
15-16 M 1:17.69 1:27.29 1:14.59 0:30.99 1:09.79 2:32.29 5:24.89 2:49.89
17-19 F 1:21.99 1:32.99 1:19.59 0:33.59 1:13.79 2:40.19 5:36.99 3:00.59
17-19 M 1:15.39 1:24.89 1:12.89 0:30.19 1:07.49 2:28.59 5:16.39 2:45.99
""",
}
TIME = re.compile(r"^(?:(\d{1,2}):)?\d{2}\.\d{2}$")

def build():
    champs = []
    for cid, name in [("long-distance", "Long Distance Champs"), ("short-distance", "Short Distance Champs")]:
        standards = {}
        for course in ("SCM", "LCM"):
            order, by_group = COLUMNS[cid][course]
            table = {ev: {} for ev in order}
            for line in PRINTED[(cid, course)].strip().splitlines():
                age, sex, *times = line.split()
                events = next(evs for groups, evs in by_group.items() if age in groups)
                if len(times) != len(events):
                    raise SystemExit(f"{cid} {course} {age} {sex}: {len(times)} times for {len(events)} events")
                for ev, t in zip(events, times):
                    if not TIME.match(t):
                        raise SystemExit(f"{cid} {course} {age} {sex} {ev}: bad time {t}")
                    table[ev].setdefault(age, {})[sex] = t
            standards[course] = table
        champs.append({"id": cid, "name": name, "standards": standards})
    return {
        "id": "efsl-2025-2028",
        "title": "EFSL Championship Qualification Times 2025-2028",
        "organization": "European Forces Swim League (EFSL)",
        "seasons": "2025-2028",
        "source": "EFSL Champs Cut Times (2025-2028).pdf, 4 pages; transcribed 2026-10-01",
        "notes": [
            "Times are exactly as printed (M:SS.hh; some printed with a leading 0:).",
            "sex: F = girls, M = boys (SDIF sex codes).",
            "An event missing for an age group means the source has no time for it.",
            "The source doesn't say how age is determined (e.g. age on a cutoff date) or whether a time equal to the standard qualifies.",
        ],
        "ageGroups": [{"id": a, "minAge": lo, "maxAge": hi} for a, lo, hi in AGE_GROUPS],
        "championships": champs,
    }

if __name__ == "__main__":
    data = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=2) + "\n")
    JS.write_text("// Generated by tools/make_efsl_standards.py from standards/efsl-2025-2028.json; don't edit.\n"
                  "(function (root) {\nconst EFSL = " + json.dumps(data, separators=(",", ":")) + ";\n"
                  'if (typeof module !== "undefined" && module.exports) module.exports = EFSL;\nelse root.EFSL = EFSL;\n'
                  '})(typeof window !== "undefined" ? window : globalThis);\n')
    n = sum(len(s) for c in data["championships"] for t in c["standards"].values() for g in t.values() for s in g.values())
    print(f"wrote {OUT.name}: {n} times")
