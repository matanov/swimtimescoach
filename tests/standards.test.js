// Run: npm test   (Node 18+, no dependencies)
// EFSL qualification times, standards/efsl-2025-2028.json (built by tools/make_efsl_standards.py)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const CL2 = require("../src/cl2.js");
const efsl = require("../standards/efsl-2025-2028.json");

const champ = id => efsl.championships.find(c => c.id === id);
const cs = t => CL2.parseTime(t, "").cs;

test("every standard is a readable time for a known age group and sex", () => {
  const groups = new Set(efsl.ageGroups.map(g => g.id));
  let n = 0;
  for (const c of efsl.championships) for (const [course, events] of Object.entries(c.standards)) {
    assert.ok(["SCM", "LCM"].includes(course));
    for (const [event, byAge] of Object.entries(events)) {
      assert.match(event, /^\d+ (Free|Back|Breast|Fly|IM)$/);
      for (const [age, bySex] of Object.entries(byAge)) {
        assert.ok(groups.has(age), age);
        for (const [sex, t] of Object.entries(bySex)) { assert.ok(sex === "F" || sex === "M"); assert.ok(cs(t) > 0, t); n++; }
      }
    }
  }
  assert.equal(n, 490);
});

test("long course standards are never faster than short course", () => {
  for (const c of efsl.championships) for (const [event, byAge] of Object.entries(c.standards.LCM))
    for (const [age, bySex] of Object.entries(byAge)) for (const [sex, t] of Object.entries(bySex)) {
      const scm = c.standards.SCM[event]?.[age]?.[sex];
      if (scm) assert.ok(cs(t) >= cs(scm), `${c.id} ${event} ${age} ${sex}: LCM ${t} < SCM ${scm}`);
    }
});

test("spot checks against the printed tables, including cells next to blank columns", () => {
  const ld = champ("long-distance").standards, sd = champ("short-distance").standards;
  assert.equal(ld.SCM["200 IM"]["8&U"].F, "4:47.66");      // last column for 8 & U is 200 IM
  assert.equal(ld.SCM["1500 Free"]["11"].F, "26:35.29");   // 1500 starts at 11
  assert.equal(ld.SCM["400 IM"]["12"].M, "6:56.99");
  assert.equal(ld.SCM["200 Back"]["13"].F, "3:08.89");     // 200s replace 100s from 13
  assert.equal(ld.LCM["800 Free"]["17-19"].M, "11:29.19");
  assert.equal(sd.SCM["100 IM"]["10"].M, "1:44.79");
  assert.equal(sd.SCM["200 IM"]["11"].F, "3:32.99");
  assert.equal(sd.SCM["400 Free"]["14"].M, "5:23.99");
  assert.equal(sd.LCM["200 Free"]["9"].F, "3:51.38");      // LCM page: no 100 IM, no 200 IM below 11
  assert.equal(sd.LCM["200 IM"]["11"].M, "3:40.69");
  assert.equal(sd.LCM["50 Free"]["15-16"].M, "0:30.99");
  assert.equal(ld.SCM["100 Back"]["13"], undefined);       // blank in the source
  assert.equal(sd.LCM["100 IM"], undefined);
  assert.equal(sd.LCM["200 IM"]["10"], undefined);
});

const EFSL = require("../src/standards-efsl.js");
const swim = (dist, stroke, course, time) => ({ dist, stroke, course, time: CL2.parseTime(time, "") });

test("the app's standards script is the same data as the JSON", () => {
  assert.deepEqual(EFSL, efsl);
});

test("a swim qualifies for the championship whose standard it meets", () => {
  const q = CL2.qualifyingChamp;
  assert.equal(q(EFSL, swim(800, "1", "SCM", "13:09.89"), 12, "F"), "long-distance");   // equal to the standard counts
  assert.equal(q(EFSL, swim(800, "1", "SCM", "13:09.90"), 12, "F"), null);              // a hundredth slower doesn't
  assert.equal(q(EFSL, swim(50, "1", "LCM", "0:30.99"), 15, "M"), "short-distance");    // 15 is in 15-16
  assert.equal(q(EFSL, swim(100, "2", "SCM", "1:10.00"), 13, "M"), "short-distance");   // 100 Back: Short Distance from 13
  assert.equal(q(EFSL, swim(100, "2", "SCM", "1:10.00"), 12, "M"), "long-distance");    // ...Long Distance up to 12
  assert.equal(q(EFSL, swim(50, "1", "SCY", "20.00"), 12, "M"), null);                  // no yards standards
  assert.equal(q(EFSL, swim(50, "1", "SCM", "20.00"), 20, "M"), null);                  // no group for 20
  assert.equal(q(EFSL, swim(50, "1", "SCM", "20.00"), null, "M"), null);
  assert.equal(q(EFSL, { ...swim(50, "1", "SCM", "20.00"), time: CL2.parseTime("DQ", "X") }, 12, "M"), null);
});

test("swims are judged at the swimmer's latest age", () => {
  // met the 11-year-old 400 Free standard (6:37.29) but is now 12 (6:22.69)
  const s = swim(400, "1", "SCM", "6:30.00");
  assert.equal(CL2.qualifyingChamp(EFSL, s, 11, "F"), "long-distance");
  assert.equal(CL2.qualifyingChamp(EFSL, s, 12, "F"), null);
});

test("a swim that hasn't qualified reports how much it still needs to drop", () => {
  const sf = (dist, stroke, course, time, age, sex) => CL2.standardFor(EFSL, swim(dist, stroke, course, time), age, sex);
  // 12 F 800 Free SCM standard (Long Distance) is 13:09.89
  assert.deepEqual(sf(800, "1", "SCM", "13:12.00", 12, "F"),
    { champ: "long-distance", standard: CL2.parseTime("13:09.89", "").cs, gap: 211, meets: false, ageGroup: "12", age: 12 });
  assert.equal(sf(800, "1", "SCM", "13:09.89", 12, "F").gap, 0);                     // equal: met, no gap
  assert.equal(sf(800, "1", "SCM", "13:00.00", 12, "F").meets, true);
  // 13 M 100 Back LCM standard (Short Distance) is 1:29.59: the gap is per course
  const lc = sf(100, "2", "LCM", "1:31.00", 13, "M"), sc = sf(100, "2", "SCM", "1:31.00", 13, "M");
  assert.deepEqual([lc.champ, lc.gap, sc.champ, sc.gap], ["short-distance", 141, "short-distance", 731]);
  assert.equal(sf(100, "5", "LCM", "1:20.00", 12, "M"), null);                       // no 100 IM standard in LCM
  assert.equal(sf(50, "1", "SCY", "30.00", 12, "M"), null);
  // latest age: 6:30.00 met the 11 400 Free standard but is 7.31 s off the 12 one
  assert.deepEqual([sf(400, "1", "SCM", "6:30.00", 11, "F").meets, sf(400, "1", "SCM", "6:30.00", 12, "F").gap], [true, 731]);
});

test("close-to-qualifying report lists best times within the chosen % of a standard", () => {
  // two people, synthetic swims; 12 F 800 Free SCM LD standard 13:09.89 (78989 cs)
  const mk = (pkey, dist, stroke, course, time, date) => ({ pkey, dist, stroke, course, date, time: CL2.parseTime(time, "") });
  const people = new Map([
    ["ANNA", { key: "ANNA", last: "Zeta", first: "Anna", lastAge: 12, sex: "F" }],
    ["BEA", { key: "BEA", last: "Alpha", first: "Bea", lastAge: 13, sex: "F" }],
  ]);
  const swims = [
    mk("ANNA", 800, "1", "SCM", "13:40.00", "2025-10-01"),   // 3.81% off LD 800 Free
    mk("ANNA", 800, "1", "SCM", "13:30.00", "2025-11-01"),   // her best: 2.55% off
    mk("ANNA", 400, "1", "SCM", "6:20.00", "2025-11-01"),    // meets the 12 F LD 400 Free (6:22.69): not listed
    mk("ANNA", 50, "1", "SCM", "40.00", "2025-11-01"),       // SD 50 Free 36.29: 10.2% off
    mk("BEA", 100, "1", "LCM", "1:21.00", "2025-12-01"),     // 13 F SD 100 Free LCM 1:19.59: 1.77% off
    mk("BEA", 100, "1", "SCM", "1:30.00", "2025-12-01"),     // SCM 1:16.69: 17.4% off
    mk("NOBODY", 100, "1", "LCM", "1:00.00", "2025-12-01"),  // not a selected person
  ];
  const at5 = CL2.nearStandards(EFSL, swims, people, 5);
  assert.deepEqual(at5.map(r => [r.champ, r.person.first, `${r.swim.dist} ${r.swim.course}`, CL2.fmt(r.swim.time.cs), +r.gapPct.toFixed(2)]),
    [["long-distance", "Anna", "800 SCM", "13:30.00", 2.55], ["short-distance", "Bea", "100 LCM", "1:21.00", 1.77]]);
  assert.equal(CL2.nearStandards(EFSL, swims, people, 1.5).length, 0);
  assert.equal(CL2.nearStandards(EFSL, swims, people, 20).length, 4);   // adds Anna's 50 Free and Bea's 100 SCM
  // Anna's 400 Free qualified in SCM, so a near-miss LCM 400 Free (12 F LD LCM 6:32.89) isn't listed
  const withLcm = [...swims, mk("ANNA", 400, "1", "LCM", "6:40.00", "2025-12-01")];        // 1.8% off on its own
  assert.ok(!CL2.nearStandards(EFSL, withLcm, people, 5).some(r => r.swim.dist === 400));
  assert.ok(CL2.qualifiedEvents(EFSL, withLcm, people).has("ANNA|400|1"));
  // ...but it would be listed if she hadn't qualified in SCM
  const lcmOnly = withLcm.filter(s => !(s.dist === 400 && s.course === "SCM"));
  assert.ok(CL2.nearStandards(EFSL, lcmOnly, people, 5).some(r => r.swim.dist === 400 && r.swim.course === "LCM"));
  // exactly at the limit counts: 2.55...% for Anna
  const exact = at5[0].gapPct;
  assert.equal(CL2.nearStandards(EFSL, swims, people, exact).filter(r => r.person.first === "Anna").length, 1);
});

test("birth dates come from USS IDs only when they match the ages in the results", () => {
  assert.equal(CL2.ageOn("2013-11-30", "2026-11-27"), 12);   // birthday three days after champs
  assert.equal(CL2.ageOn("2013-11-27", "2026-11-27"), 13);   // birthday on the first day counts
  assert.equal(CL2.birthFromId("113013ANNAZETA", "2025-10-11", 11), "2013-11-30");
  assert.equal(CL2.birthFromId("113013ANNAZETA", "2025-10-11", 12), null);    // age doesn't match: not a birth date
  assert.equal(CL2.birthFromId("ID00001", "2025-10-11", 11), null);
  assert.equal(CL2.birthFromId("133013XXXX", "2025-10-11", 11), null);       // month 13
});

test("swimmers are judged at their age on each championship's first day", () => {
  const LD = EFSL.championships.find(c => c.id === "long-distance"), SD = EFSL.championships.find(c => c.id === "short-distance");
  assert.deepEqual([LD.date, SD.date], ["2026-11-27", "2027-02-27"]);
  // 12 all season (latest age 12); born 2014-01-15: 12 at LD champs, 13 at SD champs
  const p = { key: "ANNA", lastAge: 12, sex: "F", birth: "2014-01-15" };
  assert.deepEqual([CL2.ageAt(p, LD), CL2.ageAt(p, SD)], [12, 13]);
  assert.equal(CL2.ageAt(p, SD, { "short-distance": "2027-01-10" }), 12);  // a date override moves it
  assert.equal(CL2.ageAt({ ...p, birth: null }, SD), 12);                  // no birth date: latest age
  assert.equal(CL2.ageAt({ ...p, birth: null, champAges: { "short-distance": 13 } }, SD), 13);  // ages carried by a shared file
  // 50 Free SCM 34.00: meets the 12 F Short Distance standard (36.29) but not the 13 one (34.19)
  const swim = { dist: 50, stroke: "1", course: "SCM", time: CL2.parseTime("34.00", "") }, slow = { ...swim, time: CL2.parseTime("34.50", "") };
  const at = person => c => CL2.ageAt(person, c);
  assert.equal(CL2.standardFor(EFSL, swim, at(p), "F").meets, true);
  const q = CL2.standardFor(EFSL, slow, at(p), "F");
  assert.deepEqual([q.champ, q.age, q.meets, q.gap], ["short-distance", 13, false, 31]);
  assert.equal(CL2.standardFor(EFSL, slow, at({ ...p, birth: null }), "F").meets, true);   // at 12 it would qualify
});

test("people get a birth date from their IDs, and shared files can mask the IDs", () => {
  const line = (name, id12, age, date) => "D0" + " ".repeat(9) + name.padEnd(28) + id12.padEnd(12) + " ".repeat(12) + String(age).padStart(2) + "F" + "F" +
    "  50" + "1" + "   1" + "UNOV" + date + " ".repeat(25) + "   34.00S";
  const text = ["B1         Test Meet" + " ".repeat(90) + "1011202510112025" + " ".repeat(12) + "S",
    "C1         ZZTEST" + "Test Team",
    line("Zeta, Anna", "113013ANNAZE", 11, "10112025"), "D3113013ANNAZETAAnna", ""].join("\r\n");
  const { swims } = CL2.parseCL2(text, "t.cl2");
  const p = [...CL2.assignPeople(swims).values()][0];
  assert.equal(p.birth, "2013-11-30");
  const mk = CL2.maskIds([text]), [masked] = mk.texts;
  assert.equal(mk.key("ZETA|ANNA|113013ANNAZETA"), "ZETA|ANNA|ID00002");    // same-name split keys follow the stand-ins
  assert.equal(mk.key("ZETA|ANNA"), "ZETA|ANNA");
  assert.ok(!/113013/.test(masked));
  const m = CL2.parseCL2(masked, "t.cl2").swims[0];
  assert.deepEqual([m.swimmer.uss, m.swimmer.ussNew, m.swimmer.pref], ["ID00001", "ID00002", "Anna"]);
  assert.equal([...CL2.assignPeople([m]).values()][0].birth, null);
  assert.equal(masked.split("\r\n").length, text.split("\r\n").length);
});
