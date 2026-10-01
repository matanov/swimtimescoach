// Run: npm test   (Node 18+, no dependencies)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("../vendor/jszip.min.js");
const CL2 = require("../src/cl2.js");
const { saveSession, readSession } = require("../src/session.js");

const fixture = name => fs.readFileSync(path.join(__dirname, "fixtures", name), "latin1");
const reopen = async bytes => readSession(await JSZip.loadAsync(bytes));

test("a saved session reopens with the same files, selection and print option", async () => {
  const sources = ["fall-invite-2024.cl2", "fall-invite.cl2", "winter-champs.cl2"]
    .map(name => ({ name, text: fixture(name) }));
  const people = CL2.assignPeople(sources.flatMap(s => CL2.parseCL2(s.text, s.name).swims));
  const rossi = [...people.values()].find(p => p.last === "Rossi").key;

  const s = await reopen(await saveSession(JSZip, { sources, selected: new Set([rossi]), appendix: true, view: "event" }));
  assert.deepEqual(s.sources, sources);
  assert.deepEqual(s.selected, [rossi]);
  assert.equal(s.appendix, true);
  assert.equal(s.view, "event");

  // person keys are derived from the files, so they still match after re-parsing
  const again = CL2.assignPeople(s.sources.flatMap(x => CL2.parseCL2(x.text, x.name).swims));
  assert.ok(again.has(rossi));
});

test("files with the same name are both kept", async () => {
  const sources = [{ name: "results.cl2", text: fixture("fall-invite.cl2") },
                   { name: "results.cl2", text: fixture("winter-champs.cl2") }];
  const s = await reopen(await saveSession(JSZip, { sources, selected: [], appendix: false }));
  assert.deepEqual(s.sources, sources);
});

test("non-latin characters survive the round trip", async () => {
  const sources = [{ name: "Città/meet.cl2", text: "D0 Müller, Zoë" }];
  const s = await reopen(await saveSession(JSZip, { sources, selected: [], appendix: false }));
  assert.deepEqual(s.sources, sources);
});

test("an ordinary results zip is not a session", async () => {
  const zip = new JSZip();
  zip.file("meet.cl2", fixture("fall-invite.cl2"));
  assert.equal(await readSession(zip), null);
});

test("a session from a newer app version is refused", async () => {
  const zip = new JSZip();
  zip.file("session.json", JSON.stringify({ app: "cl2-best-times", version: 99, files: [] }));
  await assert.rejects(readSession(zip), /newer version/);
});

test("a session saved before views existed has no view", async () => {
  const zip = new JSZip();
  zip.file("session.json", JSON.stringify({ app: "cl2-best-times", version: 1, files: [], selected: [] }));
  assert.equal((await readSession(zip)).view, null);
});
