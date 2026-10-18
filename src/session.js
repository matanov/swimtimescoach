/*
 * Saved sessions: one .zip holding every loaded .cl2/.sd3 text plus
 * session.json (selected swimmers, print option, table view, your team, EFSL quals on/off,
 * championship dates; in shared files, each swimmer's age at the championships). Opening it re-parses the
 * files, so a session always reflects the current parser. Nothing is stored
 * anywhere but the file the user downloads.
 *
 * JSZip is passed in so this works in the browser (window.Session) and in
 * Node (require) for tests.
 */
(function (root) {
"use strict";
const MANIFEST = "session.json";
const APP = "cl2-best-times";
const VERSION = 1;

// sources: [{name, text}], selected: iterable of person keys
// champDates: {championship id: "YYYY-MM-DD"} the user set; champAges: {person key: {championship id: age}},
// written into shared files, whose IDs are masked and so carry no birth dates
async function saveSession(JSZip, {sources, selected, appendix, view, team, efsl, champDates, champAges}){
  const zip = new JSZip();
  const files = sources.map((s, i) => {
    // index prefix keeps same-named files (e.g. two "results.cl2") apart
    const path = `meets/${String(i + 1).padStart(3, "0")}-${s.name.replace(/[\\/:*?"<>|]/g, "_")}`;
    zip.file(path, s.text);
    return {path, name: s.name};
  });
  zip.file(MANIFEST, JSON.stringify({
    app: APP, version: VERSION, saved: new Date().toISOString(),
    files, selected: [...selected], appendix: !!appendix, view: view || "course", team: team || null, efsl: !!efsl,
    champDates: champDates || {}, ...(champAges ? {champAges} : {}),
  }, null, 2));
  return zip.generateAsync({type: "uint8array", compression: "DEFLATE"});
}

// Returns {sources, selected, appendix, view, team, efsl, champDates, champAges}, or null if the zip isn't a saved session.
// view and team are null for sessions saved before they existed (team is also null for one-team data).
async function readSession(zip){
  const mf = zip.file(MANIFEST);
  if (!mf) return null;
  let m;
  try { m = JSON.parse(await mf.async("string")); } catch { return null; }
  if (!m || m.app !== APP) return null;
  if (m.version > VERSION) throw new Error("saved by a newer version of this app");
  const sources = [];
  for (const {path, name} of m.files || []) {
    const f = zip.file(path);
    if (!f) throw new Error(`session is missing ${name}`);
    sources.push({name, text: await f.async("string")});
  }
  const view = ["course", "event"].includes(m.view) ? m.view : null;
  const team = typeof m.team === "string" ? m.team : null;
  const isDate = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const champDates = Object.fromEntries(Object.entries(m.champDates || {}).filter(([, v]) => isDate(v)));
  const champAges = m.champAges && typeof m.champAges === "object" ? m.champAges : null;
  return {sources, selected: Array.isArray(m.selected) ? m.selected : [], appendix: !!m.appendix, view, team, efsl: !!m.efsl, champDates, champAges};
}

const api = { saveSession, readSession, MANIFEST };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.Session = api;
})(typeof window !== "undefined" ? window : globalThis);
