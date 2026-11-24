// Scan = list session files, re-read only the ones that changed (cache), classify, apply done/snooze, track resumes.
import fs from "node:fs";
import path from "node:path";
import { listSessionFiles, readSession, defaultRoot } from "./reader.mjs";
import { classify, isLooseEnd } from "./detect.mjs";
import { loadJson, saveJson } from "./store.mjs";

const CACHE_V = 3;
const HOUR = 3600e3;
const DAY = 24 * HOUR;

export function projectName(cwd) {
  if (!cwd) return "unknown";
  return path.basename(cwd.replace(/[\\/]+$/, "")) || cwd;
}

export function displayTitle(s) {
  const t = (s.title || s.firstPrompt || "(untitled session)").replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 79)}…` : t;
}

/**
 * @param {object} o
 * @param {string} [o.root]           Claude Code projects folder
 * @param {number} [o.now]
 * @param {number} [o.budgetMs]       stop re-reading changed files after this long (used by the session-start hook)
 * @param {string} [o.excludeId]      the current session
 * @param {number} [o.minIdleHours]   ignore sessions active more recently than this
 * @param {number} [o.maxAgeDays]     ignore sessions older than this
 * @param {boolean} [o.includeOffers] include "want me to also…?" endings
 * @param {boolean} [o.track]         record flags / resumes in state.json (default true)
 */
export function scan(o = {}) {
  const root = o.root || defaultRoot();
  const now = o.now ?? Date.now();
  const budgetMs = o.budgetMs ?? Infinity;
  const minIdle = (o.minIdleHours ?? 6) * HOUR;
  const maxAge = (o.maxAgeDays ?? 30) * DAY;
  const track = o.track !== false;
  const t0 = Date.now();

  let cache = loadJson("cache.json", { v: CACHE_V, files: {} });
  if (cache.v !== CACHE_V) cache = { v: CACHE_V, files: {} };
  const state = loadJson("state.json", { items: {}, hook: {} });
  state.items ||= {};

  const files = listSessionFiles(root)
    .map((f) => { try { return { f, st: fs.statSync(f) }; } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);

  let dirty = false, partial = false, reread = 0;
  const byId = new Map(); // a moved/relocated session can exist in two project folders: keep the newest copy
  const seen = new Set();
  for (const { f, st } of files) {
    seen.add(f);
    let c = cache.files[f];
    if (!c || c.size !== st.size || c.mtimeMs !== st.mtimeMs) {
      if (Date.now() - t0 > budgetMs) { partial = true; if (!c) continue; }
      else {
        try { c = { size: st.size, mtimeMs: st.mtimeMs, s: readSession(f, st) }; } catch { continue; }
        cache.files[f] = c; dirty = true; reread++;
      }
    }
    const prev = byId.get(c.s.sessionId);
    if (!prev || c.s.lastTs > prev.lastTs) byId.set(c.s.sessionId, c.s);
  }
  const sessions = [...byId.values()];
  for (const k of Object.keys(cache.files)) if (!seen.has(k)) { delete cache.files[k]; dirty = true; }
  if (dirty) saveJson("cache.json", cache);

  const items = [];
  const counts = {};
  for (const s of sessions) {
    const c = classify(s.digest);
    counts[c.state] = (counts[c.state] || 0) + 1;
    const st = state.items[s.sessionId];

    // Resume tracking: the user came back after we flagged it.
    if (track && st && st.flaggedAt && !st.resumedAt && s.lastTs > (st.flaggedLastTs || 0)) {
      st.resumedAt = s.lastTs;
    }
    // New activity after "done" or a snooze means it's a new situation.
    if (st && st.doneAt && s.lastTs > (st.doneLastTs || 0)) { delete st.doneAt; delete st.doneLastTs; }

    if (!isLooseEnd(c, o)) continue;
    if (s.sessionId === o.excludeId) continue;
    const idle = now - s.lastTs;
    if (idle < minIdle || idle > maxAge) continue;
    if (st && st.doneAt) continue;
    if (st && st.snoozeUntil && st.snoozeUntil > now) continue;

    if (track) {
      const rec = (state.items[s.sessionId] ||= {});
      if (!rec.flaggedAt || rec.resumedAt) {
        // (Re)flag: first time, or it was resumed and is waiting again.
        if (rec.resumedAt) { rec.history = [...(rec.history || []), { flaggedAt: rec.flaggedAt, resumedAt: rec.resumedAt }].slice(-20); delete rec.resumedAt; }
        rec.flaggedAt = now; rec.flaggedLastTs = s.lastTs; rec.kind = c.kind;
      }
    }

    items.push({
      id: s.sessionId,
      short: s.sessionId.slice(0, 8),
      state: c.state,
      kind: c.kind,
      weight: c.weight,
      question: c.question,
      title: displayTitle(s),
      project: projectName(s.cwd),
      cwd: s.cwd,
      lastTs: s.lastTs,
      idleHours: idle / HOUR,
      links: s.digest.links || [],
      session: s,
    });
  }
  items.sort((a, b) => b.weight * 10 - b.idleHours / 24 - (a.weight * 10 - a.idleHours / 24));
  if (track) saveJson("state.json", state);
  return { items, counts, scanned: sessions.length, reread, partial, ms: Date.now() - t0 };
}

export function findItem(result, idPrefix) {
  const p = String(idPrefix || "").trim().toLowerCase();
  if (!p) return null;
  const matches = result.items.filter((i) => i.id.toLowerCase().startsWith(p));
  return matches.length === 1 ? matches[0] : matches.length > 1 ? { ambiguous: matches } : null;
}

/** Finds any session (flagged or not) by id prefix, from the cache. */
export function findSession(idPrefix) {
  const p = String(idPrefix || "").trim().toLowerCase();
  const cache = loadJson("cache.json", { files: {} });
  const byId = new Map();
  for (const c of Object.values(cache.files || {})) {
    const s = c.s;
    if (!s || !s.sessionId.toLowerCase().startsWith(p)) continue;
    const prev = byId.get(s.sessionId);
    if (!prev || s.lastTs > prev.lastTs) byId.set(s.sessionId, s);
  }
  const all = [...byId.values()];
  return all.length === 1 ? all[0] : all.length > 1 ? { ambiguous: all } : null;
}

export function setItemState(sessionId, patch) {
  const state = loadJson("state.json", { items: {}, hook: {} });
  state.items ||= {};
  const rec = (state.items[sessionId] ||= {});
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete rec[k]; else rec[k] = v; }
  saveJson("state.json", state);
  return rec;
}

export function stats(now = Date.now()) {
  const state = loadJson("state.json", { items: {} });
  let flagged = 0, resumed = 0, resumed48 = 0, done = 0, up = 0, down = 0, handled = 0, measurable48 = 0;
  for (const rec of Object.values(state.items || {})) {
    const rounds = [...(rec.history || []), ...(rec.flaggedAt ? [{ flaggedAt: rec.flaggedAt, resumedAt: rec.resumedAt }] : [])];
    for (const r of rounds) {
      flagged++;
      const in48 = r.resumedAt && r.resumedAt - r.flaggedAt <= 48 * HOUR;
      if (r.resumedAt) { resumed++; if (in48) resumed48++; }
      // The 48 h rate can only be judged once 48 h have passed (or it was already picked up).
      if (in48 || now - r.flaggedAt >= 48 * HOUR) measurable48++;
    }
    if (rec.doneAt) done++;
    if (rec.feedback === "up") up++;
    if (rec.feedback === "down") down++;
    if (rec.feedback === "handled") handled++;
  }
  const rated = up + down + handled;
  return {
    flagged, resumed, resumed48, measurable48, done, up, down, handled,
    precision: rated ? (up + handled) / rated : null, // the flag pointed at a real loose end
    useful: rated ? up / rated : null, // ...that was still open when shown
  };
}
