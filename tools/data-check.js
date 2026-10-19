#!/usr/bin/env node
/*
 * Check real meet files for unusual results, without printing anything personal.
 *
 *   node tools/data-check.js <folder> [more folders...] [--out FILE]
 *
 * Prints only counts and patterns. The detail (swimmer names, meets, times) goes to
 * a private file, by default ~/swim-private/data-check.txt (mode 600), never the repo.
 *
 * Checks: status codes (SCR, NS, DQ, DNF, NT...) per round; events where a swimmer
 * has only codes (the table then shows "SCR"); "N swims" counts that include
 * scratches; implausible paces; times far off the swimmer's own other times in the
 * same event and course; times coded for another pool than the meet's; duplicate
 * swims; ages going down between meets.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const CL2 = require("../src/cl2.js");

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? args.splice(outIdx, 2)[1] : path.join(os.homedir(), "swim-private", "data-check.txt");
if (!args.length) { console.error("usage: node tools/data-check.js <folder> [more folders] [--out FILE]"); process.exit(1); }
if (!path.relative(path.resolve(__dirname, ".."), path.resolve(out)).startsWith("..")) {
  console.error("Error: the detail file holds swimmer names; write it outside the repo (--out)"); process.exit(1);
}

const files = args.flatMap(dir => fs.readdirSync(dir).filter(n => /\.(cl2|sd3)$/i.test(n)).map(n => path.join(dir, n)));
const parsed = files.map(f => ({ file: path.basename(f), ...CL2.parseCL2(fs.readFileSync(f, "latin1"), path.basename(f)) }));
const swims = parsed.flatMap(p => p.swims);
CL2.labelMeets(parsed.map(p => p.meet));
const people = CL2.assignPeople(swims);

const counts = {}, detail = {};
const add = (check, line) => { counts[check] = (counts[check] || 0) + 1; (detail[check] = detail[check] || []).push(line); };
const who = s => `${s.swimmer.first} ${s.swimmer.last} (${s.teamName || s.team})`;
const ev = s => `${s.dist} ${CL2.STROKES[s.stroke]} ${s.course}`;
const at = s => `${s.meet.label}, ${s.date}`;
const label = s => s.time.cs != null ? CL2.fmt(s.time.cs) : (s.time.dq ? "DQ" : s.time.code || s.time.raw);

// 1. status codes by round
const codes = {};
for (const s of swims) if (s.time.cs == null) {
  const c = s.time.dq ? "DQ" : (s.time.code || "?");
  codes[c] = codes[c] || {}; codes[c][s.round] = (codes[c][s.round] || 0) + 1;
  if (!["DQ", "SCR", "NS", "DNF", "NT", "DFS"].includes(c)) add("unexpected status code", `${who(s)} · ${ev(s)} · ${s.round} · raw "${s.time.raw}" · ${at(s)}`);
}

// group by person + event + course
const groups = new Map();
for (const s of swims) { const k = `${s.pkey}|${s.dist}|${s.stroke}|${s.course}`; (groups.get(k) || groups.set(k, []).get(k)).push(s); }
for (const list of groups.values()) {
  const valid = list.filter(s => s.time.cs != null), s0 = list[0];
  // 2. only codes: the table shows the code instead of a time
  if (!valid.length) add("event with no valid time (table shows the code)", `${who(s0)} · ${ev(s0)} · ${list.map(s => `${s.round} ${label(s)} at ${at(s)}`).join("; ")}`);
  // 3. swim counts that include scratches / no-shows
  const nonSwims = list.filter(s => ["SCR", "NS"].includes(s.time.code));
  if (nonSwims.length && list.length > 1) add('"N swims" count includes SCR/NS', `${who(s0)} · ${ev(s0)} · shows ${list.length} swims, ${nonSwims.length} of them ${[...new Set(nonSwims.map(s => s.time.code))].join("/")}`);
  // 5. far off the swimmer's own times (median of the others)
  if (valid.length >= 3) for (const s of valid) {
    const others = valid.filter(x => x !== s).map(x => x.time.cs).sort((a, b) => a - b), med = others[Math.floor(others.length / 2)];
    const off = (s.time.cs - med) / med;
    if (Math.abs(off) > 0.15) add("time far off the swimmer's other times (>15%)", `${who(s)} · ${ev(s)} · ${label(s)} vs usual ${CL2.fmt(med)} (${(off * 100).toFixed(0)}%) · ${s.round} · ${at(s)}`);
  }
}

for (const s of swims) {
  if (s.time.cs == null || !s.dist) continue;
  // 4. implausible pace per 100 (world records are ~0:46 per 100; slower than 4:00 per 100 is likely a typo)
  const pace = s.time.cs / 100 / (s.dist / 100);
  if (pace < 46 || pace > 240) add("implausible pace", `${who(s)} · ${ev(s)} · ${label(s)} (${pace.toFixed(1)} s per 100) · ${s.round} · ${at(s)}`);
  // 6. time coded for another pool than the meet's
  if (s.meet.course && s.course !== s.meet.course) add("time coded for a different pool than the meet", `${who(s)} · ${ev(s)} in a ${s.meet.course} meet · ${label(s)} · ${s.round} · ${at(s)}`);
}

// 7. duplicates: same person, event, course, round, date and time in more than one place
const seen = new Map();
for (const s of swims) {
  if (s.time.cs == null) continue;
  const k = `${s.pkey}|${s.dist}|${s.stroke}|${s.course}|${s.round}|${s.date}|${s.time.cs}`;
  if (seen.has(k)) add("duplicate swim", `${who(s)} · ${ev(s)} · ${s.round} ${label(s)} on ${s.date} · in ${seen.get(k)} and ${s.meet.file}`);
  else seen.set(k, s.meet.file);
}

// 8. age going down from one meet to a later one
for (const p of people.values()) {
  const mine = swims.filter(s => s.pkey === p.key && s.age != null && s.date).sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < mine.length; i++) if (mine[i].age < mine[i - 1].age) {
    add("age goes down between meets", `${p.first} ${p.last} · ${mine[i - 1].age} on ${mine[i - 1].date}, then ${mine[i].age} on ${mine[i].date}`); break;
  }
}

// private detail file
const text = [`Data check of ${files.length} files (${swims.length} swims, ${people.size} swimmers), ${new Date().toISOString().slice(0, 10)}`, "",
  "Status codes by round:", ...Object.entries(codes).map(([c, r]) => `  ${c}: ${Object.entries(r).map(([k, v]) => `${k} ${v}`).join(", ")}`), "",
  ...Object.entries(detail).flatMap(([check, lines]) => [`== ${check} (${lines.length})`, ...lines.sort().map(l => "  " + l), ""])].join("\n");
fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
fs.writeFileSync(out, text, { mode: 0o600 });

// counts only on the console
console.log(JSON.stringify({ files: files.length, swims: swims.length, swimmers: people.size, teams: CL2.listTeams(swims).length,
  status_codes_by_round: codes, findings: counts }, null, 1));
console.log(`Detail (names, meets, times): ${out.replace(os.homedir(), "~")}`);
