// Run: npm test   (Node 18+, no dependencies)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const CL2 = require("../src/cl2.js");
const A = require("../tools/anonymize.js");

const NAMES = ["fall-invite-2024.cl2", "fall-invite.cl2", "winter-champs.cl2", "summer-lc.cl2"];
const inputs = () => NAMES.map(name => ({ name, text: fs.readFileSync(path.join(__dirname, "fixtures", name), "latin1") }));
const run = (map = A.emptyMap(), ins = inputs()) => ({ map, ins, ...A.anonymizeAll(ins, map, { ourTeam: "ITTEST" }) });
const REAL = ["Rossi", "Bianchi", "Verdi", "Marco", "Sofia", "Luca", "Luke", "010111MARAROSS", "020111LUCAVERD",
              "ITTEST", "Test Aquatics", "Fall Invite", "Winter Champs", "Summer LC", "Vicenza"];

test("no real name, ID, team, meet or city survives, in contents or file names", () => {
  const { outputs } = run();
  for (const o of outputs) for (const r of REAL) {
    assert.ok(!o.text.toUpperCase().includes(r.toUpperCase()), `${r} in ${o.name}`);
    assert.ok(!o.name.toUpperCase().includes(r.toUpperCase().replace(/ /g, "-")), `${r} in file name ${o.name}`);
  }
});

test("built-in leak and equivalence checks pass", () => {
  const { outputs, map } = run();
  const leaks = A.leakCheck(outputs, map);
  assert.deepEqual(leaks.hits, []);
  assert.ok(leaks.checked > 20);
  const eq = A.equivalenceCheck(outputs, map);
  assert.deepEqual(eq.problems, []);
  assert.equal(eq.swims, 14);
});

test("leak check catches a real name that slipped through", () => {
  const { outputs, map } = run();
  const fake = Object.values(map.swimmers).find(s => s.real.last === "Rossi");
  outputs[0].text = outputs[0].text.replace(`${fake.last}, ${fake.first}`, "Rossi, Marco");
  assert.deepEqual([...new Set(A.leakCheck(outputs, map).hits.map(h => h.kind))].sort(), ["first name", "last name", "preferred name", "swimmer name"]);
});

test("fake meets are numbered in date order, whatever the file order", () => {
  const { outputs } = run(A.emptyMap(), inputs().reverse());
  assert.deepEqual(outputs.map(o => o.name),
    ["2024-10-06-fall-meet-1.cl2", "2025-07-15-summer-meet-1.cl2", "2025-10-05-fall-meet-2.cl2", "2025-12-12-winter-meet-1.cl2"]);
});

test("records keep their fixed-width layout", () => {
  for (const o of run().outputs) for (const l of o.text.split("\r\n").filter(Boolean)) assert.ok(l.length <= 160);
});

test("a swimmer gets the same fake name in every file, and results are unchanged", () => {
  const { outputs } = run();
  const parsed = outputs.map(o => CL2.parseCL2(o.text, o.name));
  assert.deepEqual(outputs.map(o => o.input.name).sort(), [...NAMES].sort());
  const swims = parsed.flatMap(p => p.swims);
  const people = CL2.assignPeople(swims);
  assert.equal(people.size, 2);
  const marco = swims.find(s => s.time.raw === "24.51");
  assert.equal(new Set(swims.filter(s => s.pkey === marco.pkey).map(s => s.meet.file)).size, 4);
  const free50 = swims.filter(s => s.pkey === marco.pkey && s.dist === 50 && s.course === "SCY");
  assert.equal(CL2.fmt(CL2.bestOf(free50).time.cs), "24.51");
  assert.ok(parsed.every(p => p.swims.every(s => s.teamName === "Chicken Cats")));
});

test("names are mixed movie stars, matched to sex, never a real star's full name", () => {
  const { outputs, map } = run();
  const s = CL2.parseCL2(outputs.find(o => o.input.name === "fall-invite.cl2").text, "x").swims;
  const sofia = Object.values(map.swimmers).find(x => x.real.last === "Bianchi");
  assert.ok(s.some(x => x.swimmer.first === sofia.first && x.swimmer.sex === "F"));
  for (const x of Object.values(map.swimmers)) assert.notEqual(`${x.first} ${x.last}`, "Tom Hanks");
});

test("rerunning with the saved mapping gives identical output", () => {
  const first = run();
  const map = JSON.parse(JSON.stringify(first.map));
  const second = run(map);
  assert.deepEqual(second.outputs.map(o => o.text), first.outputs.map(o => o.text));
  assert.equal(second.stats.newSwimmers, 0);
});

test("records the app doesn't read are dropped; unknown records stop the run", () => {
  const ins = inputs();
  ins[0].text = ins[0].text.replace("Z0", "E0 relay team with real names\r\nZ0");
  const { outputs, stats } = run(A.emptyMap(), ins);
  assert.equal(stats.dropped.E0, 1);
  assert.ok(!outputs[0].text.includes("E0"));
  ins[0].text = ins[0].text.replace("E0", "Q9");
  assert.throws(() => run(A.emptyMap(), ins), /unknown record type "Q9"/);
});

test("CLI refuses a mapping inside the repo and output that isn't git-ignored", () => {
  const cli = args => { try { execFileSync("node", ["tools/anonymize.js", ...args], { cwd: path.join(__dirname, ".."), stdio: "pipe" }); return ""; }
                        catch (e) { return e.stderr.toString(); } };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anon-"));
  assert.match(cli(["tests/fixtures", "--map", "tests/map.json", "--out", tmp]), /outside the repo/);
  assert.match(cli(["tests/fixtures", "--map", path.join(tmp, "m.json"), "--out", "src/out"]), /not git-ignored/);
  const ok = cli(["tests/fixtures", "--map", path.join(tmp, "m.json"), "--out", path.join(tmp, "out")]);
  assert.equal(ok, "");
  assert.equal(fs.readdirSync(path.join(tmp, "out")).length, 4);
  fs.rmSync(tmp, { recursive: true });
});
