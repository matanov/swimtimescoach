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
  const lcm = X.standard(60, "LCM", "SCM", 100, "1");
  assert.equal(lcm.t, 58.6);
  assert.ok(Math.abs(X.standard(lcm.raw, "SCM", "LCM", 100, "1").raw - 60) < 1e-9);
  const back = X.standard(150, "SCM", "LCM", 200, "2").t;
  assert.ok(back > 150 && back < 154, back);
  assert.equal(X.standard(50, "SCY", "LCM", 100, "1").t, 56.5);   // 50.00 y -> 56.5 LCM
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
  const plan = X.plan(sample(), {...ALL, tgt:"LCM", method:"custom", fac:{LCM:{SCM:1.02, SCY:1.13}}, off:{LCM:0.5, SCM:-9}});
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

test("review lists every entry with original, relabeled and converted times", () => {
  const rv = X.review(sample(), {...ALL, tgt:"LCM", method:"relabel", fields:[true,false,false,false]});
  assert.equal(rv.method, "standard");                 // relabel → converted column uses the standard conversion
  assert.equal(rv.rows.length, 14);
  const r = rv.rows.find(r => r.who === "Conti, Sofia L" && r.event === "200 Breast");
  assert.deepEqual([r.orig, r.relabeled, r.status], [{time:"2:51.18", course:"SCM"}, {time:"2:51.18", course:"LCM"}, "change"]);
  assert.equal(r.converted.course, "LCM");
  assert.ok(r.delta > 0 && r.converted.time !== "2:51.18");
  const same = rv.rows.find(r => r.event === "100 Free" && r.who === "Rossi, Giulia A");
  assert.deepEqual([same.status, same.converted.time, same.delta, same.note], ["same", "1:04.12", null, "already LCM"]);
  const im = rv.rows.find(r => r.event === "100 IM");
  assert.equal(im.status, "skipped"); assert.equal(im.converted, null); assert.match(im.note, /no standard factor/);
  assert.equal(im.relabeled.course, "LCM");
  const odd = rv.rows.find(r => r.who === "Moretti, Anna V");
  assert.ok(odd.unusual); assert.match(odd.note, /check time/);
  assert.deepEqual(rv.counts, {total:14, change:9, same:3, nt:0, skipped:2, excluded:0, unusual:1, fallback:0});
});

test("review uses custom factors when chosen and marks unselected courses", () => {
  const rv = X.review(sample(), {...ALL, tgt:"LCM", method:"custom", fac:{LCM:{SCM:1.02, SCY:1.13}}, srcs:{SCM:true, SCY:false}});
  assert.equal(rv.method, "custom");
  assert.equal(rv.rows.find(r => r.orig.time === "29.84").converted.time, "30.44");
  const y = rv.rows.find(r => r.orig.course === "SCY");
  assert.equal(y.status, "excluded"); assert.equal(y.converted.course, "SCY"); assert.equal(y.relabeled.course, "SCY");
});

test("review CSV has a header and one quoted row per entry", () => {
  const csv = X.reviewCSV(X.review(sample(), {...ALL, tgt:"LCM", method:"standard"}));
  const rows = csv.trim().split("\r\n");
  assert.match(rows[0], /^Line,Swimmer,Age,Sex,Event,Field,Target course,Original time/);
  assert.equal(rows.length, 15);
  assert.ok(rows.some(r => r.startsWith('4,"Rossi, Giulia A",14,F,50 Free,Seed,LCM,29.84,SCM,29.84,LCM,')));
});

test("review is sorted A–Z by swimmer, then stroke and distance, relays last", () => {
  const rv = X.review(sample(), {...ALL, tgt:"LCM", method:"standard"});
  const names = rv.rows.filter(r => !r.relay).map(r => r.who);
  assert.deepEqual([...new Set(names)], ["Bianchi, Marco T", "Conti, Sofia L", "Greco, Luca P", "Moretti, Anna V", "Rossi, Giulia A"]);
  assert.deepEqual(rv.rows.filter(r => r.who === "Rossi, Giulia A").map(r => r.event), ["50 Free", "100 Free", "200 IM"]);
  assert.deepEqual(rv.rows.filter(r => r.who === "Conti, Sofia L").map(r => r.event), ["400 Free", "100 Breast", "200 Breast"]);
  assert.deepEqual(rv.rows.slice(-2).map(r => r.event), ["200 Free Relay", "200 Medley Relay"]);
});

test("events lists each event once with counts per course, relays last", () => {
  const ev = X.events(sample());
  assert.deepEqual(ev.slice(0, 3).map(e => e.event), ["50 Free", "100 Free", "200 Free"]);
  assert.deepEqual(ev.slice(-2).map(e => e.event), ["200 Free Relay", "200 Medley Relay"]);
  const f50 = ev.find(e => e.key === "501");
  assert.deepEqual(f50.counts, {SCM:1});
});

test("two-pool meet: per-event target course", () => {
  const p = sample();
  // Default LCM; 50 Free and 100 Breast swum in the 25 m pool.
  const o = {...ALL, tgt:"LCM", method:"standard", perEvent:{"501":"SCM", "1003":"SCM"}};
  const plan = X.plan(p, o);
  const get = (who, ev) => plan.changes.find(c => c.it.who === who && c.it.event === ev);
  assert.equal(get("Rossi, Giulia A", "50 Free"), undefined);          // already SCM: left as is
  assert.equal(get("Conti, Sofia L", "100 Breast"), undefined);
  const lcm = get("Rossi, Giulia A", "100 Free");
  assert.equal(lcm, undefined);                                         // already LCM
  const c = get("Conti, Sofia L", "200 Breast");
  assert.equal(c.tgt, "LCM"); assert.equal(c.newCode, "L"); assert.ok(c.newSecs > c.it.secs);
  assert.equal(plan.meetChange, null);                                  // meet course follows the default (already LCM)
  // An LCM time in an event set to SCM is converted down.
  const d = X.plan(p, {...o, perEvent:{"1001":"SCM"}}).changes.find(c => c.it.raw.trim() === "1:04.12");
  assert.equal(d.tgt, "SCM"); assert.equal(d.newCode, "S"); assert.ok(d.newSecs < d.it.secs);
  const out = X.parse(X.build(p, plan));
  assert.deepEqual(out.items.filter(i => i.event === "50 Free").map(i => i.course), ["SCM"]);
  assert.deepEqual(out.items.filter(i => i.event === "200 Breast").map(i => i.course), ["LCM"]);
});

test("two-pool meet: custom factors per target, review and CSV show each target", () => {
  const o = {...ALL, tgt:"SCM", method:"custom", perEvent:{"2002":"LCM"},
    fac:{SCM:{LCM:0.98, SCY:1.11}, LCM:{SCM:1.02, SCY:1.13}}};
  const plan = X.plan(sample(), o);
  const back = plan.changes.find(c => c.it.event === "100 Back");     // SCM, stays SCM: no change
  assert.equal(back, undefined);
  const b200 = plan.changes.find(c => c.it.event === "200 Back");     // LCM, event set to LCM
  assert.equal(b200, undefined);
  const free = plan.changes.find(c => c.it.raw.trim() === "1:04.12"); // LCM → SCM × 0.98
  assert.equal(free.newSecs, Math.round(64.12 * 0.98 * 100) / 100);
  const rv = X.review(sample(), {...o, perEvent:{"1002":"LCM"}});
  assert.ok(rv.mixed);
  assert.deepEqual(rv.other, [{event:"100 Back", tgt:"LCM"}]);
  const r = rv.rows.find(r => r.event === "100 Back");
  assert.deepEqual([r.tgt, r.status, r.converted.time], ["LCM", "change", X.fmtTime(Math.round(69.55 * 1.02 * 100) / 100)]);
  assert.match(X.reviewCSV(rv), /,100 Back,Seed,LCM,1:09\.55,SCM,1:09\.55,LCM,/);
  assert.equal(X.review(sample(), {...o, perEvent:{"1002":"SCM"}}).mixed, false);
  assert.match(X.plan(sample(), {...o, fac:{SCM:{LCM:0.98}}}).skipped[0].why, /no valid factor for SCY to SCM/);
});

// Expected values from a line-for-line port of the British Swimming / Sportsystems
// algorithm in github.com/Chester-le-Street-ASC/EquivalentTime (EquivalentTime.php):
// result = floor((t + 0.05) * 10) / 10. The port matched our formula in 3,600 cases.
test("standard conversion matches the reference implementation, rounded to 0.1 s", () => {
  for (const [t, src, tgt, dist, stroke, want] of [
    [60, "SCM", "LCM", 100, "1", 61.4], [60, "LCM", "SCM", 100, "1", 58.6], [52, "SCY", "LCM", 100, "1", 58.7],
    [160, "SCM", "LCM", 200, "3", 163.3], [150.55, "LCM", "SCM", 200, "5", 147.9], [1124.1, "SCM", "LCM", 1500, "1", 1142.3],
    [310.2, "LCM", "SCY", 400, "5", 276.7], [125.33, "SCY", "SCM", 200, "4", 137.7]])
    assert.equal(X.standard(t, src, tgt, dist, stroke).t, want, `${t} ${src}->${tgt} ${dist}/${stroke}`);
  assert.equal(X.tenth(61.35), 61.4); assert.equal(X.tenth(61.34999), 61.3); assert.equal(X.tenth(58.6), 58.6);
  const p = X.plan(sample(), {...ALL, tgt:"LCM", method:"standard"});
  assert.ok(p.changes.every(c => Math.abs(c.newSecs * 10 - Math.round(c.newSecs * 10)) < 1e-9), "tenths only");
  assert.ok(p.changes.every(c => /0$/.test(c.newRaw)));
  const r = X.standardRelay(118.2, "SCM", "LCM", 200, "6");          // legs added unrounded, then rounded once
  assert.equal(r.t, X.tenth(r.raw));
});

test("standard with custom fallback converts events without a standard factor", () => {
  const o = {...ALL, tgt:"LCM", method:"standard", fallback:true, fac:{LCM:{SCM:1.02, SCY:1.13}}, off:{LCM:0.1}};
  const p = X.plan(sample(), o);
  const im = p.changes.find(c => c.it.event === "100 IM");
  assert.equal(im.how, "fallback");
  assert.equal(im.newSecs, Math.round((72.30 * 1.02 + 0.1) * 100) / 100);
  assert.deepEqual(p.skipped.map(s => s.it.event), ["400 Free"]);      // yard 400 stays ambiguous, not a missing factor
  assert.equal(p.changes.find(c => c.it.event === "100 Fly").how, "standard");
  const rv = X.review(sample(), o);
  const row = rv.rows.find(r => r.event === "100 IM");
  assert.deepEqual([row.status, row.fallback], ["change", true]); assert.match(row.note, /custom factor/);
  assert.equal(rv.counts.fallback, 1); assert.ok(rv.fallback);
  // without the fallback, or with no factor for that course, it is skipped
  assert.ok(X.plan(sample(), {...o, fallback:false}).skipped.some(s => s.it.event === "100 IM"));
  assert.match(X.plan(sample(), {...o, fac:{}}).skipped.find(s => s.it.event === "100 IM").why, /no standard factor.*no valid factor/);
  // yard-only distances never fall back: there is no metre event of that length
  const y = X.parse(X.sampleText().replace(/( 400)(1)(  1 1314[^\r]*5:02\.90)Y/, " 5001$3Y"));
  assert.match(X.plan(y, o).skipped.find(s => s.it.dist === 500).why, /no standard factor for 500 Free/);
});

test("custom seconds per 100 are set per target course", () => {
  const o = {...ALL, tgt:"SCM", method:"custom", perEvent:{"1001":"LCM"},
    fac:{SCM:{LCM:1, SCY:1}, LCM:{SCM:1, SCY:1}}, off:{LCM:1, SCM:-0.5}};
  const p = X.plan(sample(), o);
  const toSCM = p.changes.find(c => c.it.event === "200 Back");        // 2:31.02 LCM, 200 m: −1.00
  assert.equal(toSCM.newSecs, 151.02 - 1);
  const toLCM = p.changes.find(c => c.it.event === "100 Free");
  assert.equal(toLCM, undefined);                                      // already LCM
  const rv = X.review(sample(), {...o, perEvent:{"501":"LCM"}});
  assert.equal(rv.rows.find(r => r.event === "50 Free").converted.time, "30.34");   // 29.84 + 0.5 × 1
  assert.deepEqual(rv.off, {LCM:1, SCM:-0.5});
});
