#!/usr/bin/env node
/*
 * Anonymize real SDIF v3 / CL2 files for local testing.
 *
 *   node tools/anonymize.js <input-dir> [--out DIR] [--map FILE] [--our-team CODE]
 *   node tools/anonymize.js <input-dir> --list-teams
 *
 * - Swimmers get mixed movie-star names (matched to the sex field), fake birth
 *   dates, and USS IDs rebuilt from those. The same swimmer gets the same fake
 *   identity in every file and on every run, via the mapping file.
 * - Our team becomes Chicken Cats; other teams and meets get fake names.
 * - Field allowlist: every output record starts blank and only the fields
 *   listed below are copied or written. Records the app doesn't read (B2, C2,
 *   D1, D2, E0, F0, G0) are dropped; an unknown record type stops the run.
 * - Before anything is written, a leak check scans the output for every real
 *   name, ID, team and meet in the mapping, and an equivalence check parses
 *   both versions with src/cl2.js and compares every swim.
 *
 * The mapping holds real names, so it must live outside the repo, and output
 * inside the repo must be git-ignored. Only counts are printed, never names
 * (except --list-teams, which is for running yourself).
 * Positions are SDIF v3 1-based start/length, as in docs/sdif-v3-notes.md.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const CL2 = require("../src/cl2.js");

const REPO = path.resolve(__dirname, "..");
const OUR_TEAM = { code: "ZZCHCK", name: "Chicken Cats", abbr: "CHICKEN CATS" };

/* ------------------------------------------------------------------ fake names */
const ACTRESSES = `Meryl Streep, Julia Roberts, Sandra Bullock, Nicole Kidman, Cate Blanchett,
  Natalie Portman, Scarlett Johansson, Emma Stone, Jennifer Lawrence, Viola Davis, Charlize Theron,
  Halle Berry, Reese Witherspoon, Kate Winslet, Anne Hathaway, Audrey Hepburn, Grace Kelly,
  Ingrid Bergman, Marilyn Monroe, Judy Garland, Bette Davis, Katharine Hepburn, Saoirse Ronan,
  Margot Robbie, Florence Pugh, Keira Knightley, Rachel Weisz, Amy Adams, Frances McDormand,
  Octavia Spencer, Jessica Chastain, Michelle Pfeiffer, Salma Hayek, Penelope Cruz, Diane Keaton,
  Sigourney Weaver, Jodie Foster, Susan Sarandon, Goldie Hawn, Sally Field, Glenn Close,
  Helen Mirren, Judi Dench, Maggie Smith, Olivia Colman, Gwyneth Paltrow, Kirsten Dunst,
  Drew Barrymore, Cameron Diaz, Lucy Liu, Jamie Curtis, Angela Bassett, Annette Bening,
  Tilda Swinton, Rooney Mara, Brie Larson, Gal Gadot, Lauren Bacall, Rita Hayworth, Sophia Loren,
  Vivien Leigh, Lana Turner, Ava Gardner, Doris Day, Shirley Temple, Debbie Reynolds, Winona Ryder,
  Uma Thurman, Hilary Swank, Kathy Bates, Laura Dern, Emily Blunt, Hailee Steinfeld, Elle Fanning,
  Mila Kunis, Kristen Stewart, Regina King, Taraji Henson, Constance Wu, Hedy Lamarr, Greta Garbo,
  Lily Collins, Carey Mulligan, Rosamund Pike, Felicity Huffman, Shailene Woodley, Kerry Washington,
  Anjelica Huston, Mia Farrow, Ellen Burstyn, Jane Fonda, Geena Davis, Whoopi Goldberg,
  Holly Hunter, Marion Cotillard, Juliette Binoche, Isabelle Huppert, Catherine Deneuve,
  Sissy Spacek, Faye Dunaway, Zoe Saldana, Michelle Yeoh, Sandra Oh, Gemma Chan, Thandiwe Newton,
  Tessa Thompson, Gabrielle Union, Naomi Watts, Rachel McAdams, Jennifer Hudson, Audra McDonald,
  Ruby Dee, Dorothy Dandridge, Cicely Tyson, Lena Horne, Julianne Moore, Toni Collette,
  Patricia Arquette, Allison Janney, Laura Linney`;
const ACTORS = `Tom Hanks, Denzel Washington, Morgan Freeman, Leonardo DiCaprio, Brad Pitt, George Clooney,
  Samuel Jackson, Harrison Ford, Keanu Reeves, Will Smith, Matt Damon, Ben Affleck, Hugh Jackman,
  Ryan Gosling, Chris Hemsworth, Idris Elba, Mahershala Ali, Gary Oldman, Anthony Hopkins,
  Jack Nicholson, Al Pacino, Dustin Hoffman, Sidney Poitier, Humphrey Bogart, Cary Grant,
  Clark Gable, Gregory Peck, James Stewart, Paul Newman, Steve McQueen, Clint Eastwood,
  Sean Connery, Michael Caine, Kevin Costner, Jeff Bridges, Bill Murray, Tommy Jones, Jamie Foxx,
  Forest Whitaker, Eddie Murphy, Adam Sandler, Jim Carrey, Robin Williams, Owen Wilson,
  Colin Farrell, Ralph Fiennes, Javier Bardem, Joaquin Phoenix, Jake Gyllenhaal, Oscar Isaac,
  Dev Patel, Rami Malek, Chadwick Boseman, Michael Fassbender, Jason Statham, Dwayne Johnson,
  Vin Diesel, Jackie Chan, Bruce Willis, Arnold Schwarzenegger, Sylvester Stallone, Kurt Russell,
  Mel Gibson, Liam Neeson, Pierce Brosnan, Ewan McGregor, Orlando Bloom, Viggo Mortensen,
  Ian McKellen, Patrick Stewart, Christopher Walken, Gerard Butler, Pedro Pascal, John Cho,
  Henry Cavill, Woody Harrelson, Tim Robbins, Russell Crowe, Heath Ledger, Jared Leto,
  Christian Bale, Cillian Murphy, Andrew Garfield, Tobey Maguire, Zac Efron, Mark Ruffalo,
  Ethan Hawke, Harvey Keitel, Peter Dinklage, Gene Hackman, Fred Astaire, Charlton Heston,
  Kirk Douglas, Burt Lancaster, Marlon Brando, Spencer Tracy, James Cagney, Lee Marvin,
  Laurence Olivier, Sterling Brown, Don Cheadle, Omar Sy, Daniel Kaluuya, John Boyega,
  Jeffrey Wright, Wesley Snipes, Danny Glover, Laurence Fishburne, Ving Rhames, Terrence Howard,
  Ken Watanabe, Toshiro Mifune, Antonio Banderas, Diego Luna, Robert Redford, Robert Duvall,
  Kevin Bacon, Matthew McConaughey, Johnny Depp, Nicolas Cage, John Travolta, Patrick Swayze,
  Richard Gere`;
const TEAM_ADJ = `Thunder Velvet Copper Midnight Rocket Prairie Harbor Granite Silver Crimson Golden Electric
  Cosmic Arctic Desert Coral Emerald Iron Lunar Solar Stormy Misty Polar Rapid`.split(/\s+/).filter(Boolean);
const TEAM_ANIMALS = `Otters Herons Marlins Pelicans Narwhals Walruses Penguins Seahorses Stingrays Barracudas
  Manatees Puffins Beavers Minnows Gators Turtles Orcas Lobsters Squids Frogs Swans Geese Ducks Eels`.split(/\s+/).filter(Boolean);

const people = list => list.split(",").map(s => s.trim()).filter(Boolean).map(full => {
  const i = full.lastIndexOf(" ");
  return { first: full.slice(0, i), last: full.slice(i + 1) };
});
const STARS_F = people(ACTRESSES), STARS_M = people(ACTORS);
const FIRST = { F: [...new Set(STARS_F.map(p => p.first))], M: [...new Set(STARS_M.map(p => p.first))] };
const LAST = [...new Set([...STARS_F, ...STARS_M].map(p => p.last))];
const REAL_STARS = new Set([...STARS_F, ...STARS_M].map(p => `${p.first} ${p.last}`.toUpperCase()));
// every word that can appear in a fake name; a real name made only of these can't be leak-checked
const FAKE_VOCAB = new Set([...FIRST.F, ...FIRST.M, ...LAST, ...TEAM_ADJ, ...TEAM_ANIMALS,
  ...OUR_TEAM.name.split(" "), "Fall", "Winter", "Spring", "Summer", "Meet"].map(w => w.toUpperCase()));

const pick = arr => arr[crypto.randomInt(arr.length)];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/* ------------------------------------------------------------------ fields */
const f = (line, start, len) => line.substr(start - 1, len).trim();
const put = (out, start, len, val) => out.slice(0, start - 1) + String(val).slice(0, len).padEnd(len) + out.slice(start - 1 + len);
const copy = (out, line, start, len) => out.slice(0, start - 1) + line.substr(start - 1, len) + out.slice(start - 1 + len);

// Record types the app reads, and which original fields survive untouched.
// Everything not listed is blanked; listed replacements are written below.
const KEEP = {
  A0: [[3, 1], [12, 8], [20, 2]],                       // org, SDIF version, file code
  B1: [[3, 1], [121, 1], [122, 8], [130, 8], [150, 1]], // org, meet type, start, end, course
  C1: [[3, 1]],
  D0: [[3, 1], [52, 1], [53, 3], [64, 82]],             // org, attach, citizen, age..flight status
  D3: [],
  Z0: [[3, 1], [12, 2]],
};
const DROP = new Set(["B2", "C2", "D1", "D2", "E0", "F0", "G0"]);

/* ------------------------------------------------------------------ mapping */
const emptyMap = () => ({ version: 1, swimmers: {}, teams: {}, meets: {} });
const addReal = (list, v) => { if (v && !list.includes(v)) list.push(v); };

// isoBirth as returned by CL2.sdifDate; without one, the team code tells same-name swimmers apart
const swimmerKey = (name, isoBirth, team) => CL2.norm(name) + "|" + (isoBirth || "team:" + team);

function fakeBirth(real){
  if (!CL2.sdifDate(real)) return real;   // blank or zeros: keep as is
  const m = 1 + crypto.randomInt(12), d = 1 + crypto.randomInt(28);
  return String(m).padStart(2, "0") + String(d).padStart(2, "0") + real.slice(4);
}

// Shaped like a real USS ID (MMDDYY + name letters), cut or padded to the original length.
function fakeUss(len, s){
  if (!len) return "";
  const b = /^\d{8}$/.test(s.birth) ? s.birth.slice(0, 4) + s.birth.slice(6) : "000000";
  const id = b + (s.first.toUpperCase() + "***").slice(0, 3) + (s.middle || "*") +
             (s.last.toUpperCase().replace(/[^A-Z]/g, "") + "****").slice(0, 4);
  return (id + "*".repeat(len)).slice(0, len);
}
const fakeFullName = s => `${s.last}, ${s.first}${s.middle ? " " + s.middle : ""}`;

function swimmerFor(map, line, team){
  const name = f(line, 12, 28), birth = f(line, 56, 8), sex = f(line, 66, 1);
  const key = swimmerKey(name, CL2.sdifDate(birth), team);
  let s = map.swimmers[key];
  if (!s) {
    const used = new Set(Object.values(map.swimmers).map(x => x.last + "|" + x.first));
    const firsts = sex === "F" ? FIRST.F : sex === "M" ? FIRST.M : [...FIRST.F, ...FIRST.M];
    let first, last;
    do { first = pick(firsts); last = pick(LAST); }
    while (used.has(last + "|" + first) || REAL_STARS.has(`${first} ${last}`.toUpperCase()));
    const n = CL2.splitName(name);
    s = map.swimmers[key] = { first, last, middle: n.middle ? pick(LETTERS) : "", birth: fakeBirth(birth),
      real: { first: n.first, last: n.last, pref: [], ids: [] }, isNew: true };
  }
  addReal(s.real.ids, f(line, 40, 12));
  return s;
}

function teamFor(map, code, ourTeam){
  let t = map.teams[code];
  const ours = ourTeam && matchesTeam(code, ourTeam);
  if (!t || (ours && t.code !== OUR_TEAM.code)) {
    if (ours) t = { ...OUR_TEAM };
    else {
      const used = new Set(Object.values(map.teams).map(x => x.name));
      let name;
      do name = `${pick(TEAM_ADJ)} ${pick(TEAM_ANIMALS)}`; while (used.has(name));
      const n = Object.values(map.teams).filter(x => x.code !== OUR_TEAM.code).length + 1;
      t = { code: "ZZT" + String(n).padStart(3, "0"), name, abbr: name.toUpperCase() };
    }
    t.real = map.teams[code]?.real || { codes: [], names: [] };
    map.teams[code] = t;
  }
  return t;
}
const matchesTeam = (code, ours) => { const o = ours.toUpperCase(); return code.startsWith(o) || code.slice(2).startsWith(o); };

function meetFor(map, name, start){
  const key = CL2.norm(name) + "|" + start;
  let m = map.meets[key];
  if (!m) {
    const iso = CL2.sdifDate(start), month = iso ? +iso.slice(5, 7) : 0;
    const season = !month ? "" : ["Winter", "Winter", "Spring", "Spring", "Spring", "Summer", "Summer", "Summer", "Fall", "Fall", "Fall", "Winter"][month - 1] + " ";
    const n = Object.values(map.meets).filter(x => x.name.startsWith(season + "Meet ")).length + 1;
    m = map.meets[key] = { name: `${season}Meet ${n}`, real: { name, cities: [] } };
  }
  return m;
}

/* ------------------------------------------------------------------ anonymize */
function anonymizeText(text, map, ourTeam, stats){
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const out = [];
  let team = "", swimmer = null, meet = null, start = "";
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) { out.push(raw); continue; }
    const line = raw.padEnd(160), rec = line.slice(0, 2);
    if (DROP.has(rec)) { stats.dropped[rec] = (stats.dropped[rec] || 0) + 1; continue; }
    if (!KEEP[rec]) throw new Error(`unknown record type "${rec}"; add it to KEEP or DROP in tools/anonymize.js`);
    let o = put(" ".repeat(160), 1, 2, rec);
    for (const [s, l] of KEEP[rec]) o = copy(o, line, s, l);
    if (rec === "B1") {
      const m = meetFor(map, f(line, 12, 30), f(line, 122, 8));
      addReal(m.real.cities, f(line, 86, 20));
      o = put(o, 12, 30, m.name);
      if (!meet) { meet = m; start = f(line, 122, 8); }
    } else if (rec === "C1") {
      team = f(line, 12, 6) + f(line, 150, 1);
      const t = teamFor(map, team, ourTeam);
      addReal(t.real.codes, team); addReal(t.real.names, f(line, 18, 30)); addReal(t.real.names, f(line, 48, 16));
      o = put(put(put(o, 12, 6, t.code), 18, 30, t.name), 48, 16, t.abbr);
    } else if (rec === "D0") {
      swimmer = swimmerFor(map, line, team);
      o = put(put(put(o, 12, 28, fakeFullName(swimmer)), 40, 12, fakeUss(f(line, 40, 12).length, swimmer)), 56, 8, swimmer.birth);
    } else if (rec === "D3") {
      if (!swimmer) { stats.dropped.D3 = (stats.dropped.D3 || 0) + 1; continue; }   // nothing to attach to
      const id = f(line, 3, 14), pref = f(line, 17, 15);
      addReal(swimmer.real.ids, id); addReal(swimmer.real.pref, pref);
      o = put(put(o, 3, 14, fakeUss(id.length, swimmer)), 17, 15, pref ? swimmer.first : "");
    }
    out.push(raw.length < 160 ? o.trimEnd() : o);
  }
  return { text: out.join(eol), meet, start };
}

// inputs: [{name, text}] -> outputs: [{name, text, input, meetName}]. Mutates map.
// Files are taken in meet-date order so new fake meets are numbered chronologically.
function anonymizeAll(inputs, map, { ourTeam } = {}){
  const stats = { dropped: {} };
  const used = new Set(), outputs = [];
  const startOf = t => CL2.sdifDate(f((t.match(/^B1.*$/m)?.[0] || "").padEnd(160), 122, 8)) || "";
  const ordered = inputs.map(i => ({ i, start: startOf(i.text) })).sort((a, b) => a.start.localeCompare(b.start)).map(x => x.i);
  for (const input of ordered) {
    const r = anonymizeText(input.text, map, ourTeam, stats);
    const ext = /\.sd3$/i.test(input.name) ? ".sd3" : ".cl2";
    const base = `${CL2.sdifDate(r.start) || "undated"}-${(r.meet?.name || "meet").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    let name = base + ext;
    for (let i = 2; used.has(name); i++) name = `${base}-${i}${ext}`;
    used.add(name);
    outputs.push({ name, text: r.text, input, meetName: r.meet?.name });
  }
  const swimmers = Object.values(map.swimmers);
  stats.newSwimmers = swimmers.filter(s => s.isNew).length;
  swimmers.forEach(s => delete s.isNew);
  return { outputs, stats };
}

/* ------------------------------------------------------------------ checks */
const words = s => s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

// Every real value in the mapping must be absent from the output names and text.
// Values made only of fake-name words (a real swimmer called "Stone") are skipped and counted.
function leakCheck(outputs, map){
  const needles = [];
  const add = (kind, v) => { const w = words(v || ""); if (w.length >= 3) needles.push({ kind, w }); };
  for (const s of Object.values(map.swimmers)) {
    add("swimmer name", `${s.real.last} ${s.real.first}`); add("swimmer name", `${s.real.first} ${s.real.last}`);
    add("last name", s.real.last); add("first name", s.real.first);
    s.real.pref.forEach(p => add("preferred name", p));
    s.real.ids.forEach(id => add("USS ID", id));
  }
  for (const t of Object.values(map.teams)) { t.real.codes.forEach(c => add("team code", c)); t.real.names.forEach(n => add("team name", n)); }
  for (const m of Object.values(map.meets)) { add("meet name", m.real.name); m.real.cities.forEach(c => add("city", c)); }
  const checked = needles.filter(n => !n.w.split(" ").every(x => FAKE_VOCAB.has(x)));
  const hay = outputs.map(o => ({ name: o.name, text: ` ${words(o.name)} ${words(o.text)} ` }));
  const hits = [];
  for (const n of checked) for (const h of hay) if (h.text.includes(` ${n.w} `)) hits.push({ kind: n.kind, file: h.name });
  return { hits, checked: checked.length, skipped: needles.length - checked.length };
}

// Parses originals and outputs with the app's parser; every swim must match
// once real names and teams are swapped for their fakes.
function equivalenceCheck(outputs, map){
  let swims = 0;
  const problems = [];
  outputs.forEach((out, i) => {
    const input = out.input;
    const a = CL2.parseCL2(input.text, input.name), b = CL2.parseCL2(out.text, out.name);
    if (a.meet.start !== b.meet.start || a.meet.course !== b.meet.course || (outputs[i].meetName || "") !== b.meet.name)
      problems.push(`${outputs[i].name}: meet header differs`);
    const row = (s, name, team, pref) => [name, team, s.dist, s.stroke, s.eventNo, s.round, s.course, s.time.raw,
      s.time.dq, s.place, s.age, s.date, !!s.swimmer.ussNew, pref].join("|");
    const fake = s => map.swimmers[swimmerKey(s.swimmer.name, s.swimmer.bdate, s.team)];
    const ra = a.swims.map(s => { const x = fake(s); return row(s, x && fakeFullName(x), map.teams[s.team]?.name, s.swimmer.pref ? x?.first : ""); }).sort();
    const rb = b.swims.map(s => row(s, s.swimmer.name, s.teamName, s.swimmer.pref)).sort();
    const diff = ra.length !== rb.length ? Math.abs(ra.length - rb.length) : ra.filter((r, j) => r !== rb[j]).length;
    if (diff) problems.push(`${outputs[i].name}: ${diff} swim(s) differ`);
    swims += ra.length;
  });
  return { swims, problems };
}

/* ------------------------------------------------------------------ CLI */
async function readInputs(dir){
  const JSZip = require("../vendor/jszip.min.js");
  const inputs = [];
  const isData = n => /\.(cl2|sd3)$/i.test(n) && !/(^|\/)(__MACOSX\/|\._)/.test(n);
  const walk = async d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) await walk(p);
      else if (isData(e.name)) inputs.push({ name: path.relative(dir, p), text: fs.readFileSync(p, "latin1") });
      else if (/\.zip$/i.test(e.name)) {
        const zip = await JSZip.loadAsync(fs.readFileSync(p));
        for (const n of Object.keys(zip.files).sort()) if (isData(n))
          inputs.push({ name: path.relative(dir, p) + "/" + n, text: (await zip.files[n].async("nodebuffer")).toString("latin1") });
      }
    }
  };
  await walk(dir);
  return inputs;
}

const inside = (child, parent) => { const r = path.relative(parent, child); return !r.startsWith("..") && !path.isAbsolute(r); };
const expand = p => path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));

async function main(argv){
  const args = { out: path.join(REPO, "tests", "fixtures-private"), map: path.join(os.homedir(), "swim-private", "cl2-mapping.json") };
  const rest = [], opts = { "--out": "out", "--map": "map", "--our-team": "ourTeam" };
  for (let i = 0; i < argv.length; i++) {
    if (opts[argv[i]]) args[opts[argv[i]]] = argv[++i];
    else if (argv[i] === "--list-teams") args.listTeams = true;
    else rest.push(argv[i]);
  }
  if (rest.length !== 1) throw new Error("usage: node tools/anonymize.js <input-dir> [--out DIR] [--map FILE] [--our-team CODE] [--list-teams]");
  const inDir = expand(rest[0]), outDir = expand(args.out), mapFile = expand(args.map);

  const inputs = await readInputs(inDir);
  if (!inputs.length) throw new Error("no .cl2/.sd3 files (or zips of them) found");
  const teams = new Map();
  for (const { text } of inputs) for (const l of text.split(/\r?\n/)) if (l.startsWith("C1")) {
    const p = l.padEnd(160); teams.set(f(p, 12, 6) + f(p, 150, 1), f(p, 18, 30));
  }
  if (args.listTeams) {
    console.log("Real team codes and names (shown here only; don't share this output):");
    for (const [c, n] of teams) console.log(`  ${c.padEnd(8)} ${n}`);
    return;
  }

  if (inside(mapFile, REPO)) throw new Error("the mapping holds real names; keep it outside the repo (--map)");
  if (inside(outDir, REPO)) {
    try { execFileSync("git", ["-C", REPO, "check-ignore", "-q", path.join(outDir, "x.cl2")]); }
    catch { throw new Error(`${path.relative(REPO, outDir)} is inside the repo but not git-ignored`); }
  }
  const map = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile, "utf8")) : emptyMap();
  let ourTeam = args.ourTeam;
  if (!ourTeam && !Object.values(map.teams).some(t => t.code === OUR_TEAM.code)) {
    if (teams.size === 1) ourTeam = [...teams.keys()][0];
    else throw new Error(`${teams.size} teams found; run with --list-teams, then pass --our-team CODE`);
  }
  if (ourTeam && ![...teams.keys()].some(c => matchesTeam(c, ourTeam))) throw new Error("--our-team matches no team in these files");

  const { outputs, stats } = anonymizeAll(inputs, map, { ourTeam });
  const leaks = leakCheck(outputs, map);
  const eq = equivalenceCheck(outputs, map);
  if (leaks.hits.length) {
    const kinds = [...new Set(leaks.hits.map(h => h.kind))].join(", ");
    throw new Error(`leak check failed: ${leaks.hits.length} hit(s) (${kinds}); nothing written`);
  }
  if (eq.problems.length) throw new Error(`equivalence check failed; nothing written:\n  ${eq.problems.join("\n  ")}`);

  fs.mkdirSync(outDir, { recursive: true });
  for (const o of outputs) fs.writeFileSync(path.join(outDir, o.name), o.text, "latin1");
  fs.mkdirSync(path.dirname(mapFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 1), { mode: 0o600 });

  const dropped = Object.entries(stats.dropped).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  console.log(`Anonymized ${outputs.length} file(s) -> ${outDir}
  swimmers: ${Object.keys(map.swimmers).length} in mapping (${stats.newSwimmers} new)   teams: ${Object.keys(map.teams).length}   meets: ${Object.keys(map.meets).length}
  dropped records: ${dropped}
  leak check: passed (${leaks.checked} real values checked, ${leaks.skipped} skipped as they're also fake-name words)
  equivalence: all ${eq.swims} swims match
Mapping (real names, keep private): ${mapFile}`);
}

module.exports = { anonymizeAll, leakCheck, equivalenceCheck, emptyMap, OUR_TEAM };
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error("Error: " + e.message); process.exit(1); });
