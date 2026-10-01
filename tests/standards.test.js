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
