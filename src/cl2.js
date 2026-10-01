/*
 * CL2 / SDIF v3 parser.
 * Hy-Tek .cl2 exports are USA Swimming SDIF v3 files: fixed-width 160-char
 * records. Positions below are the spec's 1-based start/length.
 * See docs/sdif-v3-notes.md.
 *
 * Works in the browser (window.CL2) and in Node (require) for tests.
 */
(function (root) {
"use strict";
/* ------------------------------------------------------------------ SDIF v3 parsing
   Positions are the spec's 1-based start/length (USA Swimming SDIF v3, 1998). */
const STROKES = {"1":"Free","2":"Back","3":"Breast","4":"Fly","5":"IM"};
const ROUND_ORDER = {"Prelim":1,"Swim-off":2,"Final":3};
const COURSES = {"1":"SCM","S":"SCM","2":"SCY","Y":"SCY","3":"LCM","L":"LCM"};
const COURSE_ORDER = {SCY:1,SCM:2,LCM:3,"?":4};
const TIME_RE = /^(?:(\d{1,2}):)?(\d{1,2})\.(\d{2})$/;

const f = (line, start, len) => line.substr(start - 1, len).trim();
const int = s => /^\d+$/.test(s) ? parseInt(s, 10) : null;
function sdifDate(s){
  if (!/^\d{8}$/.test(s)) return null;
  const m = +s.slice(0,2), d = +s.slice(2,4), y = +s.slice(4);
  if (!m || !d || !y || m > 12 || d > 31) return null;
  return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}
function parseTime(raw, courseCode, fallbackCourse){
  raw = raw.trim(); courseCode = (courseCode || "").trim();
  const t = {raw, cs:null, code:null, course: COURSES[courseCode] || fallbackCourse || null, dq: courseCode === "X"};
  if (!raw) return null;
  const m = raw.match(TIME_RE);
  if (m) t.cs = (+(m[1]||0))*6000 + (+m[2])*100 + (+m[3]);
  else { t.code = raw.toUpperCase(); if (t.code === "DQ") t.dq = true; }
  if (t.dq) t.cs = null;
  return t;
}
function fmt(cs){
  if (cs == null) return "";
  const m = Math.floor(cs/6000), r = cs % 6000, s = Math.floor(r/100), h = r % 100;
  return m ? `${m}:${String(s).padStart(2,"0")}.${String(h).padStart(2,"0")}` : `${s}.${String(h).padStart(2,"0")}`;
}
function splitName(name){
  let last = "", rest = [];
  if (name.includes(",")) { const i = name.indexOf(","); last = name.slice(0,i).trim(); rest = name.slice(i+1).trim().split(/\s+/).filter(Boolean); }
  else { rest = name.split(/\s+/).filter(Boolean); last = rest.pop() || ""; }
  let middle = "";
  if (rest.length > 1 && rest[rest.length-1].length === 1) middle = rest.pop();
  return {last, first: rest.join(" "), middle};
}
const norm = s => s.toUpperCase().replace(/[^A-Z]/g, "");

function parseCL2(text, fileLabel){
  const meet = {name:"", start:null, end:null, course:null, city:"", file:fileLabel};
  const teams = {};
  const swims = [];
  let team = "", lastSwimmer = null;
  const swimmersInFile = new Map();
  
  for (let line of text.split(/\r?\n/)) {
    if (line.length < 2 || !line.trim()) continue;
    line = line.padEnd(160);
    const rec = line.slice(0,2);
    if (rec === "B1") {
      meet.name = f(line,12,30); meet.city = f(line,86,20);
      meet.start = sdifDate(f(line,122,8)); meet.end = sdifDate(f(line,130,8)) || meet.start;
      meet.course = COURSES[f(line,150,1)] || null;
    } else if (rec === "C1") {
      team = f(line,12,6) + f(line,150,1);
      teams[team] = f(line,18,30) || team;
    } else if (rec === "D0") {
      const name = f(line,12,28);
      const dist = int(f(line,68,4)), stroke = f(line,72,1);
      const n = splitName(name);
      const sw = {name, ...n, uss: f(line,40,12), ussNew:"", pref:"", bdate: sdifDate(f(line,56,8)), sex: f(line,66,1)};
      // D3 follows a swimmer's first D0 only; share one object per swimmer per file
      const sk = norm(name) + "|" + sw.uss + "|" + team;
      const existing = swimmersInFile.get(sk);
      const swimmer = existing || sw;
      if (!existing) swimmersInFile.set(sk, sw);
      lastSwimmer = swimmer;
      if (!dist || !STROKES[stroke]) continue; // relay-only swimmer entry
      const base = {
        swimmer, team, teamName: teams[team] || team, age: int(f(line,64,2)),
        dist, stroke, eventNo: f(line,73,4), date: sdifDate(f(line,81,8)) || meet.start, meet
      };
      const rounds = [
        ["Prelim", parseTime(f(line,98,8), f(line,106,1), meet.course), int(f(line,133,3))],
        ["Swim-off", parseTime(f(line,107,8), f(line,115,1), meet.course), null],
        ["Final", parseTime(f(line,116,8), f(line,124,1), meet.course), int(f(line,136,3))],
      ];
      for (const [round, t, place] of rounds) {
        if (!t) continue;
        swims.push({...base, round, time:t, course: t.course || meet.course || "?", place});
      }
    } else if (rec === "D3") {
      if (lastSwimmer) { lastSwimmer.ussNew = f(line,3,14); lastSwimmer.pref = f(line,17,15); }
    }
  }
  return {meet, teams, swims};
}

/* ------------------------------------------------------------------ across files */
const bestOf = list => list.filter(s => s.time.cs != null).reduce((b,s) => (!b || s.time.cs < b.time.cs) ? s : b, null);
const bySwimOrder = (a,b) => (a.date||"").localeCompare(b.date||"") || ROUND_ORDER[a.round] - ROUND_ORDER[b.round];

// Identity: normalized name; split same-name swimmers only if their USS IDs differ.
// Sets s.pkey on every swim and returns key -> person.
function assignPeople(swims){
  const byName = new Map();
  for (const s of swims) {
    const nk = norm(s.swimmer.last) + "|" + norm(s.swimmer.first);
    if (!byName.has(nk)) byName.set(nk, new Set());
    if (s.swimmer.ussNew) byName.get(nk).add(s.swimmer.ussNew.toUpperCase());
  }
  const people = new Map();
  for (const s of swims) {
    const nk = norm(s.swimmer.last) + "|" + norm(s.swimmer.first);
    const key = byName.get(nk).size > 1 ? nk + "|" + (s.swimmer.ussNew.toUpperCase() || "?") : nk;
    s.pkey = key;
    let p = people.get(key);
    if (!p) { p = {key, last:s.swimmer.last, first:s.swimmer.pref || s.swimmer.first, teams:new Set(), sex:s.swimmer.sex, count:0, lastAge:null, lastDate:""}; people.set(key, p); }
    p.teams.add(s.teamName); p.count++;
    if (s.swimmer.pref) p.first = s.swimmer.pref;
    if ((s.date||"") >= p.lastDate) { p.lastDate = s.date || ""; p.lastAge = s.age; }
  }
  return people;
}

// Different meets can share a name (the same invitational every year, or two
// clubs' "Winter Open" on one weekend). They stay separate meets; this sets
// meet.label so they can be told apart: the name alone if unique, else the
// first of year, date, city, or file name that distinguishes it.
// meet.datedLabel is for lists that print the date next to it anyway.
function labelMeets(meets){
  const groups = new Map();
  for (const m of meets) {
    const k = norm(m.name || m.file);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  const tags = [m => (m.start||"").slice(0,4), m => m.start || "", m => m.city, m => m.file];
  for (const group of groups.values()) {
    for (const m of group) {
      const name = m.name || m.file;
      m.label = m.datedLabel = name;
      if (group.length === 1) continue;
      const i = tags.findIndex(t => t(m) && group.filter(o => t(o) === t(m)).length === 1);
      const tag = tags[i < 0 ? tags.length-1 : i](m);
      m.label = `${name} (${tag})`;
      if (i > 1 || i < 0) m.datedLabel = m.label;
    }
  }
  return meets;
}

const api = { parseCL2, parseTime, fmt, splitName, sdifDate, norm,
              bestOf, bySwimOrder, assignPeople, labelMeets,
              STROKES, ROUND_ORDER, COURSES, COURSE_ORDER };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.CL2 = api;
})(typeof window !== "undefined" ? window : globalThis);
