"""Generate fully synthetic sample meets for docs/sample-data/.

Made-up team, swimmers and times (random, seeded), so they're safe to publish:
used for the demo, the README screenshots and as files to try the app with.

Times are built from the EFSL standards (standards/efsl-2025-2028.json) for each
swimmer's event, course, age and sex, scaled by a per-swimmer factor (below 1.0
mostly qualifies, just above is close, well above is far off), so the demo shows
the whole range: qualifying boxes, small and large gaps, and the Close to
qualifying report. Small per-event and per-course differences give swimmers who
qualify in one pool but not the other, and one swimmer ages up mid-season.

Run: python3 tools/make_sample_data.py
"""
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "sample-data"
STD = json.loads((ROOT / "standards" / "efsl-2025-2028.json").read_text())
random.seed(7)

def rec(code, fields):
    l = code + " " * 158
    for s, ln, v, *right in fields:
        v = str(v)
        v = v.rjust(ln) if right else v.ljust(ln)
        l = l[:s - 1] + v[:ln] + l[s - 1 + ln:]
    return l[:160]

def fmt(sec):
    m, s = divmod(round(sec * 100), 6000)
    return f"{m}:{s // 100:02d}.{s % 100:02d}" if m else f"{s // 100}.{s % 100:02d}"

def secs(t):
    m, s = (t.split(":") if ":" in t else ("0", t))
    return int(m) * 60 + float(s)

STROKE_CODE = {"Free": "1", "Back": "2", "Breast": "3", "Fly": "4", "IM": "5"}
MEETS = [  # name, date MMDDYYYY, course code (S = SCM, L = LCM), has finals
    ("Fall Classic", "10112025", "S", False),
    ("Harvest Invite", "11082025", "S", False),
    ("Winter Long Course", "12132025", "L", False),
    ("New Year Cup", "01172026", "S", False),
    ("Spring Champs", "03142026", "L", True),
]
# name, sex, latest age, factor vs the standard at that age, events (age-up: (age before, birthday MMDD))
SWIMMERS = [
    ("Washington, Meryl A", "F", 12, 0.965, ["400 Free", "800 Free", "100 Back", "100 Fly", "50 Free", "100 Free"], None),
    ("Streep, Denzel", "M", 14, 0.985, ["50 Free", "100 Free", "200 Free", "100 Fly", "200 IM", "800 Free"], None),
    ("Hanks, Emma J", "F", 12, 1.025, ["400 Free", "100 Breast", "50 Breast", "50 Free", "100 Free", "200 Free"], (11, "0105")),
    ("Blanchett, Keanu", "M", 13, 1.035, ["100 Back", "200 Back", "50 Free", "100 Free", "400 IM", "200 IM"], None),
    ("Gosling, Viola M", "F", 14, 1.01, ["200 Back", "100 Back", "200 IM", "400 Free", "50 Free", "200 Breast"], None),
    ("Portman, Idris", "M", 12, 1.13, ["50 Free", "100 Free", "50 Back", "50 Fly", "200 Free", "100 IM"], None),
    ("Kidman, Ryan", "M", 10, 1.06, ["50 Free", "100 Free", "100 Back", "50 Fly", "200 IM", "400 Free"], None),
    ("Bullock, Cate", "F", 15, 1.09, ["100 Free", "200 Free", "100 Breast", "200 Breast", "50 Free", "800 Free"], None),
]

def age_group(age):
    return next(g["id"] for g in STD["ageGroups"] if (g["minAge"] is None or age >= g["minAge"]) and age <= g["maxAge"])

def standard(event, course, age, sex):
    for c in STD["championships"]:
        t = c["standards"][course].get(event, {}).get(age_group(age), {}).get(sex)
        if t: return secs(t)
    return None

def d0(name, sex, age, dist, stroke, ev, date, prelim, final, course, pplace="", fplace=""):
    return rec("D0", [(3, 1, "1"), (12, 28, name), (40, 12, ""), (56, 8, "00000000"), (64, 2, age),
                      (66, 1, sex), (67, 1, sex), (68, 4, dist, 1), (72, 1, stroke), (73, 4, ev, 1),
                      (77, 4, "UNOV"), (81, 8, date),
                      (98, 8, prelim, 1), (106, 1, course if prelim else ""),
                      (116, 8, final, 1), (124, 1, course if final else ""),
                      (133, 3, pplace, 1), (136, 3, fplace, 1)])

# fixed per swimmer-event and per swimmer-event-course: some events are stronger, and
# some swimmers are better in one pool than the other
event_form = {(s[0], e): random.uniform(-0.03, 0.03) for s in SWIMMERS for e in s[4]}
course_form = {(s[0], e, c): random.uniform(-0.02, 0.02) for s in SWIMMERS for e in s[4] for c in "SL"}

def meet(i, name, date, course, finals):
    cname = "SCM" if course == "S" else "LCM"
    rows = []
    for sname, sex, age, factor, events, ageup in SWIMMERS:
        before_birthday = ageup and (date[4:] == "2025" or date[:4] < ageup[1])   # season runs into 2026
        swim_age = ageup[0] if before_birthday else age
        for ev_no, event in enumerate(events, 1):
            if random.random() < 0.25:                     # not every event at every meet
                continue
            std = standard(event, cname, age, sex)        # times are built around the latest-age standard
            if std is None: continue
            trend = 1.02 - 0.01 * i                         # everyone improves over the season
            t = std * (factor + event_form[(sname, event)] + course_form[(sname, event, course)]) * trend * random.uniform(0.99, 1.01)
            dist, stroke = int(event.split()[0]), STROKE_CODE[event.split()[1]]
            place = random.randint(1, 8)
            if finals:
                f = t * random.uniform(0.985, 1.005)
                rows.append(d0(sname, sex, swim_age, dist, stroke, ev_no, date, fmt(t), fmt(f), course, place, random.randint(1, 8)))
            elif random.random() < 0.03:
                rows.append(d0(sname, sex, swim_age, dist, stroke, ev_no, date, "", "DQ", "X"))
            else:
                rows.append(d0(sname, sex, swim_age, dist, stroke, ev_no, date, "", fmt(t), course, "", place))
    lines = [rec("A0", [(3, 1, "1"), (12, 8, "V3"), (20, 2, "02")]),
             rec("B1", [(3, 1, "1"), (12, 30, name), (86, 20, "Sampleton"), (122, 8, date), (130, 8, date), (150, 1, course)]),
             rec("C1", [(3, 1, "1"), (12, 6, "ZZCHCK"), (18, 30, "Chicken Cats")])]
    return "\r\n".join(lines + rows + [rec("Z0", [(3, 1, "1")])]) + "\r\n"

OUT.mkdir(parents=True, exist_ok=True)
for old in OUT.glob("*.cl2"): old.unlink()
for i, (name, date, course, finals) in enumerate(MEETS):
    fn = f"{date[4:]}-{date[:2]}-{date[2:4]}-{name.lower().replace(' ', '-')}.cl2"
    (OUT / fn).write_text(meet(i, name, date, course, finals), newline="")
    print("wrote", fn)
