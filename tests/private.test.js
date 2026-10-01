// Runs only where anonymized real files exist (tests/fixtures-private/, git-ignored).
// Create them with: node tools/anonymize.js <folder of real .cl2 files>
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const CL2 = require("../src/cl2.js");

const dir = path.join(__dirname, "fixtures-private");
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /\.(cl2|sd3)$/i.test(n)) : [];

test("anonymized real files parse", { skip: !files.length && "no tests/fixtures-private/" }, () => {
  const parsed = files.map(n => CL2.parseCL2(fs.readFileSync(path.join(dir, n), "latin1"), n));
  for (const p of parsed) assert.ok(p.swims.length, `${p.meet.file}: no swims`);
  const swims = parsed.flatMap(p => p.swims);
  assert.ok(swims.some(s => s.teamName === "Chicken Cats"));
  for (const s of swims) assert.ok(s.time.cs != null || s.time.code || s.time.dq, `${s.meet.file}: unreadable time`);
});
