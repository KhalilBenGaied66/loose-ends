import { LABELS } from "./detect.mjs";
import { displayTitle, projectName } from "./scan.mjs";

export function ago(hours) {
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const d = Math.round(hours / 24);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

function clip(t, n) {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

export function headline(n) {
  if (n === 0) return "Nothing is waiting on you. Clean slate.";
  if (n === 1) return "1 conversation is waiting on you.";
  return `${n} conversations are waiting on you.`;
}

/** Terminal output. */
export function formatList(res, { limit = 10 } = {}) {
  const out = [];
  out.push(`Loose Ends: ${headline(res.items.length)}`);
  out.push(`(scanned ${res.scanned} sessions locally in ${res.ms} ms, 0 tokens${res.partial ? ", some changed files skipped" : ""})`);
  out.push("");
  res.items.slice(0, limit).forEach((it, i) => {
    out.push(`${String(i + 1).padStart(2)}. [${it.short}] ${LABELS[it.kind] || it.kind} · ${it.project} · ${ago(it.idleHours)}`);
    out.push(`    ${it.title}`);
    if (it.question) out.push(`    > "${clip(it.question, 160)}"`);
    if (it.links.length) out.push(`    links: ${it.links.length}`);
  });
  if (res.items.length > limit) out.push(`    …and ${res.items.length - limit} more (use --limit ${res.items.length})`);
  if (res.items.length) {
    out.push("");
    out.push("Next: loose-ends brief <id>  ·  loose-ends done <id>  ·  loose-ends snooze <id> [days]  ·  loose-ends page");
  }
  return out.join("\n");
}

/** Compact Markdown for the /loose-ends:scan command (this is what costs tokens, so keep it short). */
// Colour is never the only signal: the label is always written out next to the dot.
const DOT = { decision: "🔴", approval: "🔴", broken: "🔴", question: "🟠", interrupted: "🟠", unanswered: "🟠", your_move: "🟠", half_done: "🔵", promised: "🔵", offer: "🔵" };

const mdText = (t) => String(t).replace(/([\\[\]*_`<>])/g, "\\$1");

/** Markdown link that opens the session in the Claude desktop app, or bold text where links can't work. */
export function sessionLink(title, hostId, links) {
  const t = mdText(title);
  return links && hostId ? `**[${t}](#${hostId})**` : `**${t}**`;
}

export function formatMarkdown(res, { limit = 8, links = false } = {}) {
  const n = res.items.length;
  const out = [`**${headline(n).replace(/\.$/, "")}** · ${res.scanned} sessions checked on this computer, 0 tokens`, ""];
  res.items.slice(0, limit).forEach((it, i) => {
    out.push(`${i + 1}. ${DOT[it.kind] || "🟠"} ${sessionLink(clip(it.title, 70), it.hostId, links)} · ${LABELS[it.kind] || it.kind} · ${it.project} · ${ago(it.idleHours)} · \`${it.short}\``);
    if (it.question) out.push(`   > ${clip(it.question, 140)}`);
  });
  if (n > limit) out.push(`\n…and ${n - limit} more (\`/loose-ends:scan --limit ${n}\`).`);
  if (!n) return out.join("\n");
  const linked = links && res.items.slice(0, limit).some((it) => it.hostId);
  out.push("");
  out.push(linked ? "**Click a title** to open that session, or reply with:" : "Reply with:");
  out.push(`- \`brief 1\`: where it stopped, what it needs from you, and how to ${linked ? "open" : "resume"} it`);
  out.push("- `done 2 3`: clear the ones you've already finished");
  out.push("- `snooze 1`: hide one for a day (`snooze 1 7d` for a week)");
  return out.join("\n");
}

/**
 * Resume brief: a short, extractive summary to paste into a fresh chat (or read before `claude --resume`).
 * Built by rules from the transcript, so it costs 0 tokens to make and ~150-400 tokens to use.
 */
export function buildBrief(s, c, { now = Date.now() } = {}) {
  const d = s.digest || {};
  const hours = (now - s.lastTs) / 3600e3;
  const lines = [];
  lines.push(`Resume brief: ${displayTitle(s)}`);
  lines.push(`Project: ${projectName(s.cwd)}${s.cwd ? ` (${s.cwd})` : ""} · last active ${ago(hours)}`);
  if (s.firstPrompt) lines.push(`Goal (my first message): ${clip(s.firstPrompt, 350)}`);
  if (d.lastUserText && clip(d.lastUserText, 80) !== clip(s.firstPrompt, 80)) lines.push(`My last message: ${clip(d.lastUserText, 280)}`);
  const label = c && c.kind ? LABELS[c.kind] : "Where it stopped";
  if (c && c.question) lines.push(`Where it stopped (${label}): ${clip(c.question, 300)}`);
  else if (d.finalText) lines.push(`AI's last words: ${clip(d.finalText.slice(-400), 300)}`);
  if (d.pendingSteps && d.pendingSteps.length) {
    lines.push("Steps still open:");
    for (const p of d.pendingSteps.slice(0, 6)) lines.push(`- ${clip(p, 100)}`);
  }
  if (d.links && d.links.length) {
    lines.push("Links I shared:");
    for (const l of d.links) lines.push(`- ${l}`);
  }
  lines.push("");
  lines.push(`Continue in a terminal: cd "${s.cwd || "."}" && claude --resume ${s.sessionId}`);
  lines.push("Or paste this brief into a new chat and write your answer below.");
  lines.push("My answer / next step: ");
  return lines.join("\n");
}
