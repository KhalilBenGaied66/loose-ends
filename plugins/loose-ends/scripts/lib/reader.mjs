// Reads Claude Code session transcripts (~/.claude/projects/<project>/<session>.jsonl).
// Only the tail (and a little of the head) of each file is read, so a 40 MB session costs ~1 MB of I/O.
// No network, no model calls: everything here is plain parsing.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function defaultRoot() {
  if (process.env.LOOSE_ENDS_CLAUDE_DIR) return process.env.LOOSE_ENDS_CLAUDE_DIR;
  // Claude Code honours CLAUDE_CONFIG_DIR for where it keeps sessions; so do we.
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
}

/** Top-level session files only (sub-agent transcripts live in sub-folders and are skipped). */
export function listSessionFiles(root = defaultRoot()) {
  let dirs;
  try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(root, d.name);
    let files;
    try { files = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const f of files) if (f.isFile() && f.name.endsWith(".jsonl")) out.push(path.join(dir, f.name));
  }
  return out;
}

function readRange(file, start, length) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, start);
    return buf.subarray(0, n);
  } finally { fs.closeSync(fd); }
}

function* lines(buf, dropFirstPartial) {
  let s = 0;
  if (dropFirstPartial) {
    const i = buf.indexOf(10);
    if (i < 0) return;
    s = i + 1;
  }
  while (s < buf.length) {
    let e = buf.indexOf(10, s);
    if (e < 0) e = buf.length;
    yield buf.subarray(s, e);
    s = e + 1;
  }
}

// Cheap pre-filter so the big metadata lines (api requests, snapshots) are never JSON-parsed.
const WANTED = ['"type":"user"', '"type":"assistant"', '"type":"custom-title"'];

const SYS_BLOCK = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

export function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

/** Returns the human-typed part of a user message, or "" for automated / tool / command-output messages. */
export function cleanUserText(raw) {
  let t = String(raw || "").replace(SYS_BLOCK, "").trim();
  if (!t) return "";
  const cmd = t.match(/<command-name>([^<]*)<\/command-name>/);
  if (cmd) {
    const args = (t.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1] || "";
    return `${cmd[1].trim()} ${args.trim()}`.trim();
  }
  if (/^<pasted_content/i.test(t)) t = t.replace(/<\/?pasted_content[^>]*>/gi, "").trim();
  // Anything else that opens with a tag is harness traffic (command output, background events, notifications).
  if (/^<[a-z][\w-]*[\s>]/i.test(t)) return "";
  if (t.startsWith("Caveat:")) return "";
  return t.replace(/<\/?pasted_content[^>]*>/gi, "").trim();
}

function pushEntryEvents(e, out, meta) {
  if (e.cwd) meta.cwd = e.cwd;
  if (e.sessionId && !meta.sessionId) meta.sessionId = e.sessionId;
  if (e.type === "custom-title") {
    if (e.customTitle) meta.title = e.customTitle;
    return;
  }
  if (e.isSidechain || e.isMeta || e.isCompactSummary || e.isVisibleInTranscriptOnly) return;
  const m = e.message || {};
  const ts = e.timestamp ? Date.parse(e.timestamp) : NaN;
  if (e.type === "user") {
    const c = m.content;
    const raw = textOf(c).trim();
    if (/^\[Request interrupted/.test(raw)) {
      out.push({ kind: "interrupt", ts });
      if (Number.isFinite(ts)) meta.lastTs = Math.max(meta.lastTs || 0, ts);
      return;
    }
    if (Array.isArray(c) && c.some((b) => b && b.type === "tool_result")) {
      for (const b of c) if (b && b.type === "tool_result") out.push({ kind: "tool_result", id: b.tool_use_id, ts });
      return;
    }
    const t = cleanUserText(raw);
    if (t) {
      out.push({ kind: "user", text: t, ts });
      if (Number.isFinite(ts)) meta.lastTs = Math.max(meta.lastTs || 0, ts);
    }
    return;
  }
  if (e.type === "assistant") {
    if (Number.isFinite(ts)) meta.lastTs = Math.max(meta.lastTs || 0, ts);
    if (e.isApiErrorMessage) {
      out.push({ kind: "api_error", text: textOf(m.content).slice(0, 200), ts });
      return;
    }
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (!b) continue;
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) out.push({ kind: "assistant_text", text: b.text, ts });
      else if (b.type === "tool_use") out.push({ kind: "tool_use", name: String(b.name || ""), id: b.id, input: b.input || {}, ts });
    }
  }
}

function parseBuffer(buf, dropFirstPartial) {
  const events = [];
  const meta = {};
  for (const ln of lines(buf, dropFirstPartial)) {
    if (!WANTED.some((w) => ln.includes(w))) continue;
    let e;
    try { e = JSON.parse(ln.toString("utf8")); } catch { continue; }
    if (e && typeof e === "object") pushEntryEvents(e, events, meta);
  }
  return { events, meta };
}

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g;

/** Replays the desktop app's task list calls (update_plan) to find steps still open. */
function openPlanSteps(events) {
  let steps = null;
  for (const ev of events) {
    if (ev.kind !== "tool_use") continue;
    const n = ev.name;
    const inp = ev.input || {};
    if (n === "TodoWrite" && Array.isArray(inp.todos)) {
      steps = inp.todos.map((t) => ({ content: String(t.content || ""), status: String(t.status || "pending") }));
    } else if (/update_plan$/.test(n)) {
      if (Array.isArray(inp.items)) {
        steps = inp.items.map((t) => ({ content: String(t.content || ""), status: String(t.status || "pending") }));
      } else if (steps) {
        if (inp.advance) {
          const cur = steps.findIndex((s) => s.status === "in_progress");
          if (cur >= 0) steps[cur].status = "completed";
          const nxt = steps.findIndex((s) => s.status === "pending");
          if (nxt >= 0) steps[nxt].status = "in_progress";
        }
        for (const d of Array.isArray(inp.done) ? inp.done : []) if (steps[d - 1]) steps[d - 1].status = "completed";
        if (Number.isInteger(inp.start) && steps[inp.start - 1]) steps[inp.start - 1].status = "in_progress";
      }
    } else if (/wrap_up$/.test(n) && steps) {
      // wrap_up checks off the task list.
      for (const s of steps) s.status = "completed";
    }
  }
  return (steps || []).filter((s) => s.status !== "completed" && s.content).map((s) => s.content);
}

/** Compact, cacheable summary of the end of a session: everything the detector needs, nothing more. */
export function digest(events) {
  let lastUserIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === "user" || events[i].kind === "interrupt") { lastUserIdx = i; break; }
  }
  const after = events.slice(lastUserIdx + 1);
  const resultIds = new Set(events.filter((e) => e.kind === "tool_result").map((e) => e.id));

  let pendingAsk = null;
  for (const ev of after) {
    if (ev.kind !== "tool_use") continue;
    const inp = ev.input || {};
    if (/wrap_up$/.test(ev.name) && inp.ask) pendingAsk = { source: "wrap_up", text: String(inp.ask), blocked: !!inp.blocked };
    else if (ev.name === "AskUserQuestion" && !resultIds.has(ev.id)) {
      const q = Array.isArray(inp.questions) && inp.questions[0] ? inp.questions[0].question : "";
      pendingAsk = { source: "ask_tool", text: String(q || "Claude asked you a question") };
    } else if (ev.name === "ExitPlanMode" && !resultIds.has(ev.id)) pendingAsk = { source: "plan", text: "Approve the plan?" };
  }

  // Task-list bookkeeping calls (and their results) say nothing about who is waiting on whom.
  const bookkeeping = new Set(events.filter((e) => e.kind === "tool_use" && /(update_plan|wrap_up)$/.test(e.name)).map((e) => e.id));
  const meaningful = events.filter((e) => !((e.kind === "tool_use" || e.kind === "tool_result") && bookkeeping.has(e.id)));
  const last = meaningful[meaningful.length - 1];
  let lastKind = last ? last.kind : "none";
  if (lastKind === "tool_use" && (resultIds.has(last.id) || last.name === "AskUserQuestion" || last.name === "ExitPlanMode")) lastKind = "tool_use_done";

  const finalText = after.filter((e) => e.kind === "assistant_text").map((e) => e.text).join("\n\n").slice(-1500);
  const userEvents = events.filter((e) => e.kind === "user");
  const lastUser = userEvents[userEvents.length - 1];
  const links = [];
  for (const u of userEvents.slice(-3)) for (const m of u.text.match(URL_RE) || []) if (!links.includes(m) && links.length < 5) links.push(m);
  const apiErr = last && last.kind === "api_error" ? last.text : "";

  return {
    lastKind,
    lastUserText: lastUser ? lastUser.text.slice(0, 700) : "",
    finalText,
    pendingAsk,
    pendingSteps: openPlanSteps(events).slice(0, 8),
    links,
    apiError: apiErr,
    userTurns: userEvents.length,
  };
}

/** Reads one session file into a small, JSON-serialisable record. */
export function readSession(file, stat = fs.statSync(file)) {
  const size = stat.size;
  let parsed = { events: [], meta: {} };
  for (const span of [1 << 20, 8 << 20]) {
    const start = Math.max(0, size - span);
    parsed = parseBuffer(readRange(file, start, size - start), start > 0);
    if (parsed.events.some((e) => e.kind === "user") || start === 0) break;
  }
  const { events, meta } = parsed;

  // First thing the user asked: the "goal" line of a resume brief.
  let firstPrompt = "";
  const head = size <= (1 << 20) ? null : parseBuffer(readRange(file, 0, Math.min(size, 1 << 20)), false);
  const firstEv = (head ? head.events : events).find((e) => e.kind === "user") || events.find((e) => e.kind === "user");
  if (firstEv) firstPrompt = firstEv.text.slice(0, 500);
  if (head && head.meta.cwd && !meta.cwd) meta.cwd = head.meta.cwd;

  return {
    file,
    sessionId: meta.sessionId || path.basename(file, ".jsonl"),
    cwd: meta.cwd || "",
    title: meta.title || "",
    firstPrompt,
    lastTs: meta.lastTs || stat.mtimeMs,
    digest: digest(events),
  };
}
