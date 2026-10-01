// Run: npm test   (Node 18+, no dependencies)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const CL2 = require("../src/cl2.js");

const load = name => CL2.parseCL2(
  fs.readFileSync(path.join(__dirname, "fixtures", name), "latin1"), name);

test("parses meet header (B1)", () => {
  const { meet } = load("fall-invite.cl2");
  assert.equal(meet.name, "Fall Invite");
  assert.equal(meet.start, "2025-10-05");
  assert.equal(meet.course, "SCY");
});

test("prelim and final become separate swims", () => {
  const { swims } = load("fall-invite.cl2");
  const free = swims.filter(s => s.swimmer.last === "Rossi" && s.dist === 50);
  assert.deepEqual(free.map(s => [s.round, CL2.fmt(s.time.cs), s.place]),
    [["Prelim", "25.40", 3], ["Final", "24.98", 2]]);
});

test("D3 record attaches preferred name and new USS ID", () => {
  const { swims } = load("fall-invite.cl2");
  const s = swims.find(s => s.swimmer.last === "Rossi");
  assert.equal(s.swimmer.pref, "Marco");
  assert.equal(s.swimmer.ussNew, "010111MARAROSS");
  assert.equal(s.swimmer.middle, "A");
});

test("course code X marks a DQ with no time", () => {
  const { swims } = load("fall-invite.cl2");
  const dq = swims.find(s => s.swimmer.last === "Bianchi" && s.dist === 50);
  assert.equal(dq.time.dq, true);
  assert.equal(dq.time.cs, null);
});

test("per-time course code overrides meet course", () => {
  const { swims } = load("fall-invite.cl2");
  const im = swims.find(s => s.stroke === "5");
  assert.equal(im.course, "LCM");
});

test("time parsing and formatting round-trip", () => {
  for (const t of ["24.51", "1:01.22", "16:32.10", "9.99"]) {
    assert.equal(CL2.fmt(CL2.parseTime(t, "Y").cs), t);
  }
  assert.equal(CL2.parseTime("NS", "").code, "NS");
  assert.equal(CL2.parseTime("", ""), null);
});

test("swim-off becomes its own swim, ordered between prelim and final", () => {
  const { swims } = load("fall-invite.cl2");
  const im = swims.filter(s => s.stroke === "5").sort(CL2.bySwimOrder);
  assert.deepEqual(im.map(s => [s.round, CL2.fmt(s.time.cs)]),
    [["Prelim", "2:33.40"], ["Swim-off", "2:32.95"], ["Final", "2:31.07"]]);
});

test("relay-only D0 adds no swims, and its D3 doesn't leak to the previous swimmer", () => {
  const { swims } = load("fall-invite.cl2");
  assert.equal(swims.some(s => s.swimmer.last === "Verdi"), false);
  assert.ok(swims.filter(s => s.swimmer.last === "Bianchi").every(s => !s.swimmer.pref));
});

test("C1 team code is read from the team record", () => {
  const { teams, swims } = load("fall-invite.cl2");
  assert.deepEqual(teams, { ITTEST: "Test Aquatics" });
  assert.equal(swims[0].teamName, "Test Aquatics");
});

const loadAll = () => {
  const files = ["fall-invite-2024.cl2", "fall-invite.cl2", "winter-champs.cl2"].map(load);
  const swims = files.flatMap(f => f.swims);
  return { meets: CL2.labelMeets(files.map(f => f.meet)), swims, people: CL2.assignPeople(swims) };
};

test("same swimmer is one person across meets; best time is the fastest anywhere", () => {
  const { swims, people } = loadAll();
  assert.equal(people.size, 2);
  const rossi = [...people.values()].find(p => p.last === "Rossi");
  assert.equal(rossi.first, "Marco");
  assert.equal(rossi.lastAge, 14);
  const free50 = swims.filter(s => s.pkey === rossi.key && s.dist === 50 && s.stroke === "1");
  assert.equal(free50.length, 4);
  const best = CL2.bestOf(free50);
  assert.equal(CL2.fmt(best.time.cs), "24.51");
  assert.equal(best.meet.name, "Winter Champs");
});

test("DQ never counts as a best time", () => {
  const { swims, people } = loadAll();
  const bianchi = [...people.values()].find(p => p.last === "Bianchi");
  const free50 = swims.filter(s => s.pkey === bianchi.key && s.dist === 50);
  assert.equal(CL2.fmt(CL2.bestOf(free50).time.cs), "29.10");
  assert.equal(CL2.bestOf(free50.filter(s => s.time.dq)), null);
});

test("meets with the same name stay separate and get distinct labels", () => {
  const { meets, swims } = loadAll();
  assert.equal(meets.length, 3);
  assert.deepEqual(meets.map(m => m.label),
    ["Fall Invite (2024)", "Fall Invite (2025)", "Winter Champs"]);
  // the date is shown next to these anyway, so the year isn't repeated
  assert.deepEqual(meets.map(m => m.datedLabel), ["Fall Invite", "Fall Invite", "Winter Champs"]);
  const [m2024, m2025] = meets;
  assert.equal(swims.filter(s => s.meet === m2024).length, 1);
  assert.equal(swims.filter(s => s.meet === m2025).length, 7);
});

test("same-name meets fall back to date, then city, then file name", () => {
  const m = (start, city, file) => ({ name: "Winter Open", start, city, file });
  const label = ms => CL2.labelMeets(ms).map(x => x.label);
  assert.deepEqual(label([m("2025-01-10", "Padova", "a.cl2"), m("2025-02-14", "Padova", "b.cl2")]),
    ["Winter Open (2025-01-10)", "Winter Open (2025-02-14)"]);
  const sameDay = [m("2025-01-10", "Padova", "a.cl2"), m("2025-01-10", "Verona", "b.cl2")];
  assert.deepEqual(label(sameDay), ["Winter Open (Padova)", "Winter Open (Verona)"]);
  assert.deepEqual(sameDay.map(x => x.datedLabel), ["Winter Open (Padova)", "Winter Open (Verona)"]);
  assert.deepEqual(label([m("2025-01-10", "Padova", "a.cl2"), m("2025-01-10", "Padova", "b.cl2")]),
    ["Winter Open (a.cl2)", "Winter Open (b.cl2)"]);
});

test("same-name swimmers with different USS IDs are split", () => {
  const sw = (ussNew, date) => ({ swimmer: { last: "Rossi", first: "Marco", ussNew, pref: "", sex: "M" },
    teamName: "T", date, age: 14 });
  const people = CL2.assignPeople([sw("AAA", "2025-01-01"), sw("BBB", "2025-01-01"), sw("AAA", "2025-02-01")]);
  assert.equal(people.size, 2);
  assert.deepEqual([...people.values()].map(p => p.count), [2, 1]);
});

test("event view pairs yards and meters freestyle distances", () => {
  const sw = (dist, stroke, course) => ({ dist, stroke, course });
  assert.equal(CL2.pairedDist(sw(500, "1", "SCY")), 400);
  assert.equal(CL2.pairedDist(sw(1650, "1", "SCY")), 1500);
  assert.equal(CL2.pairedDist(sw(400, "1", "LCM")), 400);
  assert.equal(CL2.pairedDist(sw(400, "5", "SCY")), 400);   // 400 IM is the same in every course
  assert.equal(CL2.pairedDist(sw(50, "1", "SCY")), 50);
  assert.equal(CL2.pairedLabel(400, "1"), "400/500 Free");
  assert.equal(CL2.pairedLabel(1500, "1"), "1500/1650 Free");
  assert.equal(CL2.pairedLabel(400, "5"), "400 IM");
  assert.equal(CL2.pairedLabel(100, "4"), "100 Fly");
});

test("event view keeps a best per course, never comparing yards with meters", () => {
  const swims = ["fall-invite-2024.cl2", "fall-invite.cl2", "winter-champs.cl2", "summer-lc.cl2"]
    .flatMap(n => load(n).swims).filter(s => s.swimmer.last === "Rossi");
  const cell = (dist, stroke) => {
    const { short, long } = CL2.courseBests(swims.filter(s => s.stroke === stroke && CL2.pairedDist(s) === dist));
    const show = xs => xs.map(x => (x.best ? CL2.fmt(x.best.time.cs) : "") + x.letter);
    return [show(short), show(long)];
  };
  assert.deepEqual(cell(50, "1"), [["24.51Y", "26.40S"], ["27.80L"]]);
  assert.deepEqual(cell(400, "1"), [["4:52.10Y"], ["4:31.00L"]]);   // 500Y and 400L share a column
  assert.deepEqual(cell(100, "4"), [["1:01.22Y"], []]);             // no long course swim
});

test("a course with only a DQ has an entry but no best", () => {
  const { swims } = load("fall-invite.cl2");
  const { short, long } = CL2.courseBests(swims.filter(s => s.swimmer.last === "Bianchi" && s.dist === 50));
  assert.equal(short.length, 1);
  assert.equal(short[0].best, null);
  assert.equal(short[0].swims[0].time.dq, true);
  assert.deepEqual(long, []);
});
