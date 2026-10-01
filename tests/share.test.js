// Run: npm test   (Node 18+, no dependencies)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const CL2 = require("../src/cl2.js");
const { buildTemplate } = require("../tools/build-share.js");

const fixture = n => fs.readFileSync(path.join(__dirname, "fixtures", n), "latin1");

test("shared page loads nothing from outside and allows only its own scripts", () => {
  const html = buildTemplate();
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'none'/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.equal(scripts.length, 4);
  for (const js of scripts) {
    const hash = crypto.createHash("sha256").update(js, "utf8").digest("base64");
    assert.ok(csp.includes(`'sha256-${hash}'`), "inline script not allowed by the CSP hash list");
  }
  assert.equal((csp.match(/'sha256-/g) || []).length, 4);
  assert.doesNotMatch(html, /\b(src|href)="(?!data:)[^"#]/);
  assert.doesNotMatch(html, /url\("\.\./);
});

test("shared page has each placeholder once, and the data block isn't executable", () => {
  const html = buildTemplate();
  for (const k of ["date", "files", "wrap", "details", "data"])
    assert.equal(html.split(`<!--SHARE:${k}-->`).length - 1, 1, k);
  assert.match(html, /<script type="text\/plain" id="sharedSession"><!--SHARE:data--><\/script>/);
  assert.match(html, /<html lang="en" class="nojs">/);
});

test("trimming keeps only the chosen swimmers, their meets and their team", () => {
  const all = ["fall-invite.cl2", "winter-champs.cl2", "summer-lc.cl2"].map(n => ({ n, t: fixture(n) }));
  const people = CL2.assignPeople(all.flatMap(f => CL2.parseCL2(f.t, f.n).swims));
  const sofia = [...people.values()].find(p => p.last === "Bianchi").key;
  const kept = all.map(f => CL2.trimToSwimmers(f.t, [sofia]));
  assert.equal(kept[2], "");                                  // she didn't swim Summer LC
  const swims = kept.filter(Boolean).flatMap((t, i) => CL2.parseCL2(t, "s" + i).swims);
  assert.ok(swims.length && swims.every(s => s.swimmer.last === "Bianchi"));
  assert.equal(swims.length, all.slice(0, 2).flatMap(f => CL2.parseCL2(f.t, f.n).swims).filter(s => s.swimmer.last === "Bianchi").length);
  for (const t of kept.filter(Boolean)) {
    assert.ok(!/Rossi|Verdi|010111MARAROSS/.test(t));
    assert.deepEqual([...new Set(t.split("\r\n").filter(Boolean).map(l => l.slice(0, 2)))].sort(), ["B1", "C1", "D0"]);
  }
});

test("trimming drops relays and splits, and keeps a swimmer's D3", () => {
  const text = fixture("fall-invite.cl2").replace("Z0", "E0 relay\r\nF0 Rossi relay leg\r\nG0 splits\r\nZ0");
  const people = CL2.assignPeople(CL2.parseCL2(text, "x").swims);
  const marco = [...people.values()].find(p => p.last === "Rossi").key;
  const t = CL2.trimToSwimmers(text, [marco]);
  assert.ok(!/^(E0|F0|G0|Z0|A0)/m.test(t));
  const s = CL2.parseCL2(t, "x").swims;
  assert.ok(s.every(x => x.swimmer.pref === "Marco" && x.swimmer.ussNew === "010111MARAROSS"));
});

test("downloadable app and shared files carry no links back to the website", () => {
  const html = buildTemplate();
  assert.doesNotMatch(html, /data-site-only|href="swimtimescoach\.html"/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8"), /href="swimtimescoach\.html" download/);
});
