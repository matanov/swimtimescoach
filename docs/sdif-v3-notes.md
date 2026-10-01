# SDIF v3 record notes

Source: USA Swimming Standard Data Interchange Format, version 3 (1998).
Positions are 1-based `start/length`, the same convention as `f()` in `src/cl2.js`.
Only the fields the parser reads are listed.

## B1 — Meet
| Field | Start/Len |
|---|---|
| Meet name | 12/30 |
| City | 86/20 |
| Meet start (MMDDYYYY) | 122/8 |
| Meet end | 130/8 |
| Course code | 150/1 |

## C1 — Team
| Field | Start/Len |
|---|---|
| Team code (LSC + team) | 12/6 |
| Team name | 18/30 |
| Team code 5th char | 150/1 |

## D0 — Individual event
| Field | Start/Len |
|---|---|
| Swimmer name ("Last, First M") | 12/28 |
| USS# (12-char) | 40/12 |
| Birth date | 56/8 |
| Age | 64/2 |
| Sex | 66/1 |
| Event distance | 68/4 |
| Stroke (1 Free, 2 Back, 3 Breast, 4 Fly, 5 IM) | 72/1 |
| Event number | 73/4 |
| Swim date | 81/8 |
| Prelim time / course | 98/8, 106/1 |
| Swim-off time / course | 107/8, 115/1 |
| Finals time / course | 116/8, 124/1 |
| Prelim place | 133/3 |
| Finals place | 136/3 |

## D3 — Swimmer info
| Field | Start/Len |
|---|---|
| USS# (14-char, new format) | 3/14 |
| Preferred first name | 17/15 |

## Code tables
- Course: `1`/`S` = SCM, `2`/`Y` = SCY, `3`/`L` = LCM, `X` = disqualified.
- Time field: `MM:SS.hh` or `SS.hh`, or a code: `NT`, `NS`, `DNF`, `DQ`, `SCR`.
