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
