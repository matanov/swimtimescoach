"""Generate fully synthetic sample meets for docs/sample-data/.

Made-up team, swimmers and times (random, seeded), so they're safe to publish:
used for the README screenshots and as files to try the app with.

Run: python3 tools/make_sample_data.py
"""
import random
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "docs" / "sample-data"
random.seed(2026)

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

SWIMMERS = [  # name, sex, age, speed (lower is faster)
    ("Washington, Meryl A", "F", 13, 1.00),
    ("Streep, Denzel", "M", 14, 0.93),
    ("Hanks, Emma J", "F", 12, 1.07),
    ("Blanchett, Keanu", "M", 13, 0.97),
    ("Gosling, Viola M", "F", 14, 0.98),
    ("Portman, Idris", "M", 12, 1.05),
]
EVENTS = [  # distance, stroke code, base short course meters time in seconds
    (50, "1", 30.5), (100, "1", 66.0), (200, "1", 143.0),
    (100, "2", 75.0), (100, "3", 84.0), (100, "4", 74.0), (200, "5", 162.0),
]
MEETS = [  # name, date MMDDYYYY, course code (S = SCM, L = LCM), has finals
    ("Fall Classic", "10112025", "S", False),
    ("Harvest Invite", "11082025", "S", False),
    ("Winter Long Course", "12132025", "L", False),
    ("New Year Cup", "01172026", "S", False),
    ("Spring Champs", "03142026", "L", True),
]

def d0(name, sex, age, dist, stroke, ev, date, prelim, final, course, pplace="", fplace=""):
    return rec("D0", [(3, 1, "1"), (12, 28, name), (40, 12, ""), (56, 8, "00000000"), (64, 2, age),
                      (66, 1, sex), (67, 1, sex), (68, 4, dist, 1), (72, 1, stroke), (73, 4, ev, 1),
                      (77, 4, "UNOV"), (81, 8, date),
                      (98, 8, prelim, 1), (106, 1, course if prelim else ""),
                      (116, 8, final, 1), (124, 1, course if final else ""),
                      (133, 3, pplace, 1), (136, 3, fplace, 1)])

def meet(i, name, date, course, finals):
    rows = []
    lc = 1.025 if course == "L" else 1.0          # long course is a little slower
    trend = 1 - 0.006 * i                          # everyone improves over the season
    for sname, sex, age, speed in SWIMMERS:
        for ev, (dist, stroke, base) in enumerate(EVENTS, 1):
            if random.random() < 0.3:              # not everyone swims everything
                continue
            t = base * speed * lc * trend * random.uniform(0.985, 1.015)
            place = random.randint(1, 8)
            if finals:
                f = t * random.uniform(0.985, 1.005)
                rows.append(d0(sname, sex, age, dist, stroke, ev, date, fmt(t), fmt(f), course, place, random.randint(1, 8)))
            elif random.random() < 0.03:
                rows.append(d0(sname, sex, age, dist, stroke, ev, date, "", "DQ", "X"))
            else:
                rows.append(d0(sname, sex, age, dist, stroke, ev, date, "", fmt(t), course, "", place))
    lines = [rec("A0", [(3, 1, "1"), (12, 8, "V3"), (20, 2, "02")]),
             rec("B1", [(3, 1, "1"), (12, 30, name), (86, 20, "Sampleton"), (122, 8, date), (130, 8, date), (150, 1, course)]),
             rec("C1", [(3, 1, "1"), (12, 6, "ZZCHCK"), (18, 30, "Chicken Cats")])]
    return "\r\n".join(lines + rows + [rec("Z0", [(3, 1, "1")])]) + "\r\n"

OUT.mkdir(parents=True, exist_ok=True)
for i, (name, date, course, finals) in enumerate(MEETS):
    fn = f"{date[4:]}-{date[:2]}-{date[2:4]}-{name.lower().replace(' ', '-')}.cl2"
    (OUT / fn).write_text(meet(i, name, date, course, finals), newline="")
    print("wrote", fn)
