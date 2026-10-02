// Run: npm test   (Node 18+, no dependencies)
// The app is for one team; when files hold several, the user picks theirs.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const CL2 = require("../src/cl2.js");
const JSZip = require("../vendor/jszip.min.js");
const { saveSession, readSession } = require("../src/session.js");

const text = fs.readFileSync(path.join(__dirname, "fixtures-multi", "two-teams.cl2"), "latin1");
const { swims } = CL2.parseCL2(text, "two-teams.cl2");

test("teams are listed with swimmer and meet counts, biggest first", () => {
  assert.deepEqual(CL2.listTeams(swims), [
    { code: "ZZDOLP", name: "Dolphins", swimmers: 3, meets: 1 },
    { code: "ZZSHRK", name: "Sharks", swimmers: 2, meets: 1 },
  ]);
  const single = CL2.parseCL2(fs.readFileSync(path.join(__dirname, "fixtures", "fall-invite.cl2"), "latin1"), "x").swims;
  assert.equal(CL2.listTeams(single).length, 1);
});

test("picking a team keeps its Emma Smith apart from the other team's", () => {
  const dolphins = swims.filter(s => s.team === "ZZDOLP");
  const people = CL2.assignPeople(dolphins);
  assert.equal(people.size, 3);
  const emma = [...people.values()].find(p => p.last === "Smith");
  assert.deepEqual([emma.lastAge, [...emma.teams]], [14, ["Dolphins"]]);
  assert.equal(CL2.fmt(CL2.bestOf(dolphins.filter(s => s.pkey === emma.key)).time.cs), "29.05");
});

test("a shared file for one team leaves out the other team, even a namesake", () => {
  const keys = CL2.assignPeople(swims.filter(s => s.team === "ZZSHRK")).keys();
  const t = CL2.trimToSwimmers(text, [...keys], "ZZSHRK");
  const kept = CL2.parseCL2(t, "x").swims;
  assert.deepEqual(kept.map(s => [s.swimmer.last, s.age, s.teamName]).sort(), [["Neri", 13, "Sharks"], ["Smith", 12, "Sharks"]]);
  assert.ok(!t.includes("Dolphins"));
  // without a team, both Emma Smiths match by name
  assert.equal(CL2.parseCL2(CL2.trimToSwimmers(text, ["SMITH|EMMA"]), "x").swims.length, 2);
});

test("the team choice is saved in a session", async () => {
  const bytes = await saveSession(JSZip, { sources: [{ name: "t.cl2", text }], selected: [], appendix: false, view: "course", team: "ZZDOLP" });
  assert.equal((await readSession(await JSZip.loadAsync(bytes))).team, "ZZDOLP");
  const old = await saveSession(JSZip, { sources: [], selected: [], appendix: false, view: "course" });
  assert.equal((await readSession(await JSZip.loadAsync(old))).team, null);
});
