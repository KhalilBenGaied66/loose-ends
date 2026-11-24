#!/usr/bin/env node
// Loose Ends: finds AI conversations that are waiting on you. Local, zero-token, no network.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { scan, findItem, findSession, setItemState, stats } from "./lib/scan.mjs";
import { classify } from "./lib/detect.mjs";
import { formatList, formatMarkdown, buildBrief, estimateTokens, headline } from "./lib/format.mjs";
import { renderPage } from "./lib/page.mjs";
import { home, loadJson, saveJson } from "./lib/store.mjs";
import { buildDemo } from "./lib/demo.mjs";

const HELP = `loose-ends: find AI conversations that are waiting on you (local, 0 tokens)

  loose-ends [scan]            list loose ends (default)
      --all                    include optional "want me to also…?" offers
      --limit N                how many to show (default 10)
      --idle H                 only sessions idle at least H hours (default 6)
      --days D                 ignore sessions older than D days (default 30)
      --md | --json            Markdown (for Claude) or JSON output
  loose-ends brief <id>        resume brief to paste into a new chat
  loose-ends done <id>         mark as handled (comes back if the session gets new activity)
  loose-ends snooze <id> [d]   hide for d days (default 1)
  loose-ends rate <id> up|down|handled
                               still open / false alarm / already dealt with elsewhere (local stats only)
  loose-ends stats             resume rate and reminder precision
  loose-ends page              open the scan page in your browser (--no-open to just write it)
  loose-ends demo [page]       try it on made-up sessions (nothing of yours is read)
  loose-ends hook              session-start hook for Claude Code (prints one line, never fails)

<id> is the 8-character id shown in the list (any unique prefix works).
Data: ${home()}`;

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--all") a.all = true;
    else if (t === "--md") a.md = true;
    else if (t === "--json") a.json = true;
    else if (t === "--no-open") a.noOpen = true;
    else if (t === "--limit") a.limit = Number(argv[++i]);
    else if (t === "--idle") a.idle = Number(argv[++i]);
    else if (t === "--days") a.days = Number(argv[++i]);
    else if (t === "-h" || t === "--help") a.help = true;
    else a._.push(t);
  }
  return a;
}

function scanOpts(a, extra = {}) {
  return {
    includeOffers: !!a.all,
    minIdleHours: Number.isFinite(a.idle) ? a.idle : undefined,
    maxAgeDays: Number.isFinite(a.days) ? a.days : undefined,
    ...extra,
  };
}

function resolve(id) {
  const s = findSession(id);
  if (!s) { scan({ track: false }); return findSession(id); }
  return s;
}

let soft = false; // --md (inside a Claude Code command): explain problems on stdout and exit 0, so the command still runs

function fail(msg, code) {
  if (soft) { console.log(msg); process.exit(0); }
  console.error(msg);
  process.exit(code);
}

function needId(id, cmd) {
  if (!id) fail(`Usage: loose-ends ${cmd} <id>. Run "loose-ends" (or /loose-ends:scan) to see the ids.`, 2);
  const s = resolve(id);
  if (!s) fail(`No session starts with "${id}". Run "loose-ends" (or /loose-ends:scan) to see the ids.`, 1);
  if (s.ambiguous) fail(`"${id}" matches ${s.ambiguous.length} sessions; use more characters.`, 1);
  return s;
}

function openFile(file) {
  const p = process.platform;
  const [cmd, args] = p === "win32" ? ["cmd", ["/c", "start", "", file]] : p === "darwin" ? ["open", [file]] : ["xdg-open", [file]];
  try { spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref(); } catch { /* user can open it by hand */ }
}

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function hook() {
  // Must never break or slow down a session: tight time budget, always exit 0.
  try {
    if (process.env.LOOSE_ENDS_QUIET === "1") return;
    const input = readStdinJson();
    const res = scan({ budgetMs: 2500, excludeId: input.session_id });
    const n = res.items.length;
    if (!n) return;
    const here = input.cwd ? res.items.filter((i) => i.cwd && path.resolve(i.cwd).toLowerCase() === path.resolve(input.cwd).toLowerCase()).length : 0;
    const state = loadJson("state.json", { items: {}, hook: {} });
    const last = state.hook || {};
    const now = Date.now();
    // Don't nag: show again only after 3 hours, or when the count changed.
    if (last.at && now - last.at < 3 * 3600e3 && last.count === n) return;
    state.hook = { at: now, count: n };
    saveJson("state.json", state);
    const msg = `Loose Ends: ${headline(n).replace(/\.$/, "")}${here ? ` (${here} in this project)` : ""}. Type /loose-ends:scan to see them.`;
    process.stdout.write(JSON.stringify({ systemMessage: msg }));
  } catch { /* silent by design */ }
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0] || "scan";
  soft = !!a.md;
  if (a.help || cmd === "help") { console.log(HELP); return; }

  switch (cmd) {
    case "scan": {
      const res = scan(scanOpts(a));
      if (a.json) console.log(JSON.stringify({ ...res, items: res.items.map(({ session, ...i }) => i) }, null, 2));
      else if (a.md) console.log(formatMarkdown(res, { limit: a.limit || 8 }));
      else console.log(formatList(res, { limit: a.limit || 10 }));
      return;
    }
    case "brief": {
      const s = needId(a._[1], "brief");
      const text = buildBrief(s, classify(s.digest));
      console.log(text);
      if (!a.md) console.error(`\n(~${estimateTokens(text)} tokens if pasted into a chat)`);
      return;
    }
    case "done": {
      const s = needId(a._[1], "done");
      setItemState(s.sessionId, { doneAt: Date.now(), doneLastTs: s.lastTs });
      console.log(`Marked done: ${s.title || s.firstPrompt.slice(0, 60) || s.sessionId}`);
      return;
    }
    case "snooze": {
      const s = needId(a._[1], "snooze");
      const days = Number(a._[2] || 1);
      setItemState(s.sessionId, { snoozeUntil: Date.now() + days * 86400e3 });
      console.log(`Snoozed for ${days} day(s).`);
      return;
    }
    case "rate": {
      const s = needId(a._[1], "rate");
      const v = String(a._[2] || "").toLowerCase();
      if (!["up", "down", "handled"].includes(v)) fail("usage: loose-ends rate <id> up|down|handled", 2);
      if (v === "handled") {
        // Real loose end, but already dealt with outside this session: not a false alarm, and no longer worth a reminder.
        setItemState(s.sessionId, { feedback: v, feedbackAt: Date.now(), doneAt: Date.now(), doneLastTs: s.lastTs });
        console.log("Thanks: counted as handled elsewhere, and marked done.");
      } else {
        setItemState(s.sessionId, { feedback: v, feedbackAt: Date.now() });
        console.log(v === "up" ? "Thanks: counted as a useful reminder." : "Thanks: counted as a false alarm.");
      }
      return;
    }
    case "stats": {
      const st = stats();
      const pct = (x, y) => (y ? `${Math.round((100 * x) / y)}%` : "n/a");
      console.log(`Flagged so far:          ${st.flagged}`);
      console.log(`Picked back up:          ${st.resumed} (${pct(st.resumed, st.flagged)})`);
      console.log(`Picked up within 48 h:   ${st.resumed48} (${pct(st.resumed48, st.flagged)})`);
      console.log(`Marked done:             ${st.done}`);
      console.log(`Ratings:                 ${st.up} still open, ${st.handled} handled elsewhere, ${st.down} false alarm`);
      console.log(`Detector precision:      ${pct(st.up + st.handled, st.up + st.handled + st.down)} (flags that were real loose ends)`);
      console.log(`Useful reminders:        ${pct(st.up, st.up + st.handled + st.down)} (flags still open when shown)`);
      return;
    }
    case "page": {
      const res = scan(scanOpts(a));
      const file = path.join(home(), "loose-ends.html");
      fs.mkdirSync(home(), { recursive: true });
      fs.writeFileSync(file, renderPage(res, stats()));
      console.log(file);
      if (!a.noOpen) openFile(file);
      return;
    }
    case "hook":
      hook();
      return;
    case "demo": {
      // Made-up sessions in a temp folder: try it, or take screenshots, without showing your own work.
      const { root, home: demoHome } = buildDemo();
      process.env.LOOSE_ENDS_CLAUDE_DIR = root;
      process.env.LOOSE_ENDS_HOME = demoHome;
      const res = scan({ ...scanOpts(a), now: Date.now() });
      console.log("DEMO (made-up sessions, nothing of yours)\n");
      console.log(formatList(res, { limit: a.limit || 10 }));
      if (a._[1] === "page" || a._[1] === "--page") {
        const file = path.join(demoHome, "loose-ends.html");
        fs.mkdirSync(demoHome, { recursive: true });
        fs.writeFileSync(file, renderPage(res, stats()));
        console.log(`\n${file}`);
        if (!a.noOpen) openFile(file);
      }
      return;
    }
    default:
      console.error(`Unknown command "${cmd}".\n`);
      console.log(HELP);
      process.exit(2);
  }
}

main();
