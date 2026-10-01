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
