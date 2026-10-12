// SD3 course converter (src/sd3convert.js). Uses the built-in synthetic sample only.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const X = require("../src/sd3convert.js");

const ALL = {fields:[true,true,true,true], srcs:{SCM:true,SCY:true,LCM:true}, fac:{}, off:0, relays:true, meet:true};
const sample = () => X.parse(X.sampleText());
const lines = s => s.split("\r\n");
const diffCols = (a, b) => [...a].map((ch, i) => ch === b[i] ? 0 : i + 1).filter(Boolean);

test("parses meet header, entries and relays", () => {
  const p = sample();
  assert.equal(p.meet.name, "Sample Autumn Long Course");
  assert.equal(p.meet.course, "LCM");
  assert.equal(p.meet.desc, "Meet Entries");
  const seed = p.items.filter(i => i.fi === 0);
  assert.equal(seed.filter(i => !i.relay).length, 12);
  assert.equal(seed.filter(i => i.relay).length, 2);
  const g = seed.find(i => i.who === "Conti, Sofia L" && i.dist === 200);
  assert.deepEqual([g.event, g.course, g.secs], ["200 Breast", "SCM", 171.18]);
});

test("time parse and format round-trip", () => {
  for (const t of ["29.84", "1:04.12", "18:44.10", "59.99", "1:00.00"]) assert.equal(X.fmtTime(X.parseTime(t)), t);
  assert.equal(X.parseTime("NT"), null);
});

test("relabel changes only course codes and keeps every byte else", () => {
  const p = sample(), src = X.sampleText();
  const plan = X.plan(p, {...ALL, tgt:"LCM", method:"relabel"});
  assert.equal(plan.changes.length, 11);                    // 9 SCM + 1 SCY + 1 SCM relay
  assert.ok(plan.changes.every(c => c.newRaw === c.it.raw));
  const out = X.build(p, plan);
  assert.equal(out.length, src.length);
  const a = lines(src), b = lines(out);
  a.forEach((la, i) => {
    const cols = diffCols(la, b[i]);
    const rec = la.slice(0, 2);
    const allowed = rec === "D0" ? [97] : rec === "E0" ? [54] : [];
    assert.ok(cols.every(c => allowed.includes(c)), `line ${i + 1} changed cols ${cols}`);
  });
  assert.deepEqual([...new Set(X.parse(out).items.map(i => i.course))], ["LCM"]);
});

test("code style is kept: digit codes stay digits", () => {
  const p = X.parse(X.sampleText().replace(/(D01EF {6}Rossi, Giulia A[^\r]*?29\.84)S/, "$11"));
  const c = X.plan(p, {...ALL, tgt:"LCM", method:"relabel"}).changes.find(c => c.it.raw.trim() === "29.84");
  assert.equal(c.it.codeChar, "1");
  assert.equal(c.newCode, "3");
});

test("standard conversion: SCM and LCM are inverses, values are sensible", () => {
  const lcm = X.standard(60, "LCM", "SCM", 100, "1").t;
  assert.ok(Math.abs(lcm - 58.59) < 0.01, lcm);
  assert.ok(Math.abs(X.standard(lcm, "SCM", "LCM", 100, "1").t - 60) < 1e-9);
  const back = X.standard(150, "SCM", "LCM", 200, "2").t;
  assert.ok(back > 150 && back < 154, back);
  const yd = X.standard(50, "SCY", "LCM", 100, "1").t;          // 50.00 y -> ~56.5 LCM
  assert.ok(Math.abs(yd - 56.53) < 0.01, yd);
});

test("standard conversion skips events without a factor and ambiguous yard distances", () => {
  assert.match(X.standard(70, "SCM", "LCM", 100, "5").err, /no standard factor/);   // 100 IM
  assert.match(X.standard(300, "SCY", "LCM", 400, "1").err, /ambiguous/);
  const plan = X.plan(sample(), {...ALL, tgt:"LCM", method:"standard"});
  assert.deepEqual(plan.skipped.map(s => s.it.event).sort(), ["100 IM", "400 Free"]);
  assert.equal(plan.changes.length, 9);
  const r = plan.changes.find(c => c.it.relay);
  assert.ok(r.newSecs > r.it.secs);
});

test("custom factor multiplies and adds seconds per 100", () => {
  const plan = X.plan(sample(), {...ALL, tgt:"LCM", method:"custom", fac:{SCM:1.02, SCY:1.13}, off:0.5});
  const c = plan.changes.find(c => c.it.raw.trim() === "29.84");
  assert.equal(c.newSecs, Math.round((29.84 * 1.02 + 0.25) * 100) / 100);
  assert.equal(c.newRaw, "   30.69");
  assert.equal(plan.skipped.length, 0);
});

test("target SCM converts LCM times and the meet course", () => {
  const p = sample();
  const plan = X.plan(p, {...ALL, tgt:"SCM", method:"standard"});
  assert.ok(plan.changes.every(c => c.it.course === "LCM" || c.it.course === "SCY"));
  assert.ok(plan.changes.filter(c => c.it.course === "LCM").every(c => c.newSecs < c.it.secs));
  assert.equal(plan.meetChange.newCode, "S");
  const out = lines(X.build(p, plan));
  assert.equal(out[1][149], "S");
});

test("field and relay filters are respected", () => {
  const plan = X.plan(sample(), {...ALL, tgt:"LCM", method:"relabel", relays:false, srcs:{SCM:true, SCY:false}});
  assert.ok(plan.changes.every(c => !c.it.relay && c.it.course === "SCM"));
  const none = X.plan(sample(), {...ALL, tgt:"LCM", method:"relabel", fields:[false,true,true,true]});
  assert.equal(none.changes.length, 0);
});

test("LF-only files keep their line endings", () => {
  const lf = X.sampleText().replace(/\r\n/g, "\n");
  const p = X.parse(lf);
  const out = X.build(p, X.plan(p, {...ALL, tgt:"LCM", method:"standard"}));
  assert.ok(!out.includes("\r"));
  assert.equal(out.split("\n").length, lf.split("\n").length);
});
