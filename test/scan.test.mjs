import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tempEnv, session } from "./helpers.mjs";
import { scan, setItemState, stats, findSession } from "../plugins/loose-ends/scripts/lib/scan.mjs";
import { readSession } from "../plugins/loose-ends/scripts/lib/reader.mjs";
import { classify } from "../plugins/loose-ends/scripts/lib/detect.mjs";
import { buildBrief, estimateTokens } from "../plugins/loose-ends/scripts/lib/format.mjs";
import { renderPage } from "../plugins/loose-ends/scripts/lib/page.mjs";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "plugins", "loose-ends", "scripts", "loose-ends.mjs");

test("scan: idle filter, offers hidden, done/snooze, new activity un-hides, resume tracking", () => {
  const { root } = tempEnv();
  const waiting = session(root, { id: "aaaa1111-w" }).user("plan it", 30).ai("Plan ready. Should I start?", 30).write();
  session(root, { id: "bbbb2222-r" }).user("plan it", 1).ai("Plan ready. Should I start?", 1).write(); // too recent
  session(root, { id: "cccc3333-o" }).user("fix", 30).ai("Fixed. Want me to also add tests?", 30).write(); // offer
  session(root, { id: "dddd4444-f" }).user("fix", 30).ai("Fixed and verified.", 30).write();
  session(root, { id: "eeee5555-x" }).user("old", 24 * 40).ai("Should I start?", 24 * 40).write(); // too old

  let res = scan();
  assert.deepEqual(res.items.map((i) => i.short), ["aaaa1111"]);
  assert.equal(scan({ includeOffers: true }).items.length, 2);

  setItemState(waiting.id, { doneAt: Date.now(), doneLastTs: Date.now() - 30 * 3600e3 });
  assert.equal(scan().items.length, 0, "done hides it");

  // The user comes back to it and it ends on a new question: it is a new loose end, and counts as a resume.
  fs.appendFileSync(waiting.file, [
    { type: "user", sessionId: waiting.id, cwd: "C:\\work\\demo", message: { role: "user", content: "yes start" }, timestamp: new Date(Date.now() - 20 * 3600e3).toISOString() },
    { type: "assistant", sessionId: waiting.id, cwd: "C:\\work\\demo", message: { role: "assistant", content: [{ type: "text", text: "Step 1 done. Deploy to staging, or keep it local?" }] }, timestamp: new Date(Date.now() - 20 * 3600e3).toISOString() },
  ].map((e) => JSON.stringify(e)).join("\n") + "\n");
  res = scan();
  assert.equal(res.items.length, 1, "new activity after done brings it back");
  assert.equal(res.items[0].kind, "decision");
  const st = stats();
  assert.equal(st.flagged, 3, "waiting x2 (before and after the resume) + the offer seen by the --all scan");
  assert.equal(st.resumed, 1);

  setItemState(waiting.id, { snoozeUntil: Date.now() + 86400e3 });
  assert.equal(scan().items.length, 0, "snoozed");
});

test("cache: unchanged files are not re-read", () => {
  const { root } = tempEnv();
  const s = session(root).user("q", 10).ai("Ship it?", 10).write();
  assert.equal(scan().reread, 1);
  assert.equal(scan().reread, 0);
  fs.appendFileSync(s.file, JSON.stringify({ type: "user", sessionId: s.id, message: { role: "user", content: "thanks" }, timestamp: new Date(Date.now() - 9 * 3600e3).toISOString() }) + "\n");
  const r = scan();
  assert.equal(r.reread, 1);
  assert.equal(r.items.length, 0, "closed with thanks");
});

test("big session: only the tail is parsed, the goal still comes from the head", () => {
  const { root } = tempEnv();
  const s = session(root).user("GOAL: build the launch site", 50);
  const filler = "x".repeat(4000);
  for (let i = 0; i < 400; i++) s.raw({ type: "api-request-blob", message: filler });
  s.user("now the pricing section", 12).ai("Pricing is drafted. Go with $2.50, or $3?", 12).write();
  assert.ok(fs.statSync(s.file).size > 1.5e6);
  const rec = readSession(s.file);
  assert.match(rec.firstPrompt, /GOAL: build the launch site/);
  assert.equal(classify(rec.digest).kind, "decision");
});

test("brief: short, has the question, links and the resume command", () => {
  const { root } = tempEnv();
  const s = session(root, { id: "ffff6666-b" }).title("Launch plan")
    .user("Plan the launch. Ref: https://example.com/guide and https://example.org/x", 30)
    .ai("Here's the plan. Launch Tuesday, or wait for the video?", 30).write();
  const rec = readSession(s.file);
  const text = buildBrief(rec, classify(rec.digest));
  assert.match(text, /Launch plan/);
  assert.match(text, /Launch Tuesday, or wait for the video\?/);
  assert.match(text, /https:\/\/example\.com\/guide/);
  assert.match(text, /claude --resume ffff6666-b/);
  assert.ok(estimateTokens(text) < 400, `brief is ${estimateTokens(text)} tokens`);
});

test("page: user text is HTML-escaped", () => {
  const { root } = tempEnv();
  session(root).title("<script>alert(1)</script>").user("x", 10).ai("Ship <b>it</b>?", 10).write();
  const html = renderPage(scan(), stats());
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!/https?:\/\/(?!example)[^"]*\.(js|css)/.test(html), "no external scripts or styles");
});

test("id prefix lookup", () => {
  const { root } = tempEnv();
  session(root, { id: "abc12345-1" }).user("q", 10).ai("Go?", 10).write();
  session(root, { id: "abc99999-2" }).user("q", 10).ai("Go?", 10).write();
  scan();
  assert.equal(findSession("abc1").sessionId, "abc12345-1");
  assert.ok(findSession("abc").ambiguous);
});

test("a session copied into two project folders counts once (newest copy wins)", () => {
  const { root } = tempEnv();
  session(root, { id: "dupe0001-x", project: "old-folder" }).user("q", 50).tool("Bash", { command: "ls" }, 50).write();
  session(root, { id: "dupe0001-x", project: "new-folder" }).user("q", 50).ai("Done. Should I deploy?", 20).write();
  const res = scan();
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].kind, "approval");
  assert.equal(findSession("dupe").sessionId, "dupe0001-x");
});

function cli(args, input, env) {
  return spawnSync(process.execPath, [CLI, ...args], { input, encoding: "utf8", env: { ...process.env, ...env } });
}

test("hook: one systemMessage line, throttled, excludes the current session, never fails", () => {
  const { root, home } = tempEnv();
  const env = { LOOSE_ENDS_HOME: home, LOOSE_ENDS_CLAUDE_DIR: root };
  session(root, { id: "hook0001-a", cwd: "C:\\work\\demo" }).user("q", 10).ai("Should I deploy?", 10).write();
  session(root, { id: "hook0002-b", cwd: "C:\\other" }).user("q", 10).ai("Should I deploy?", 10).write();

  const r1 = cli(["hook"], JSON.stringify({ session_id: "hook0002-b", cwd: "C:\\work\\demo", source: "startup" }), env);
  assert.equal(r1.status, 0);
  const out = JSON.parse(r1.stdout);
  assert.match(out.systemMessage, /1 conversation is waiting on you \(1 in this project\)/);

  const r2 = cli(["hook"], JSON.stringify({ session_id: "hook0002-b", cwd: "C:\\work\\demo" }), env);
  assert.equal(r2.stdout, "", "same count within 3 h: stay quiet");

  const r3 = cli(["hook"], "not json", { LOOSE_ENDS_HOME: home, LOOSE_ENDS_CLAUDE_DIR: path.join(root, "missing") });
  assert.equal(r3.status, 0);
});

test("cli: rate up / handled / down feed the precision numbers; handled hides the item", () => {
  const { root, home } = tempEnv();
  const env = { LOOSE_ENDS_HOME: home, LOOSE_ENDS_CLAUDE_DIR: root };
  for (const id of ["rate0001-a", "rate0002-b", "rate0003-c", "rate0004-d"]) session(root, { id }).user("q", 10).ai("Should I deploy?", 10).write();
  cli(["scan"], "", env);
  cli(["rate", "rate0001", "up"], "", env);
  cli(["rate", "rate0002", "up"], "", env);
  assert.match(cli(["rate", "rate0003", "handled"], "", env).stdout, /handled elsewhere, and marked done/);
  cli(["rate", "rate0004", "down"], "", env);
  const st = cli(["stats"], "", env).stdout;
  assert.match(st, /2 still open, 1 handled elsewhere, 1 false alarm/);
  assert.match(st, /Detector precision:\s+75%/);
  assert.match(st, /Useful reminders:\s+50%/);
  assert.doesNotMatch(cli(["scan"], "", env).stdout, /rate0003/);
});

test("demo: made-up sessions cover every label and never touch the real folders", () => {
  const { root, home } = tempEnv();
  const r = cli(["demo"], "", { LOOSE_ENDS_HOME: home, LOOSE_ENDS_CLAUDE_DIR: root });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /DEMO \(made-up sessions/);
  assert.match(r.stdout, /9 conversations are waiting on you/);
  for (const label of ["Decision waiting", "Approval waiting", "Left broken", "Interrupted", "Your move", "Half done", "You said later"]) assert.match(r.stdout, new RegExp(label));
  assert.equal(fs.readdirSync(root).length, 0, "the real (here: test) sessions folder is untouched");
});

test("cli: brief inside a command (--md) never exits non-zero", () => {
  const { root, home } = tempEnv();
  const r = cli(["brief", "nope", "--md"], "", { LOOSE_ENDS_HOME: home, LOOSE_ENDS_CLAUDE_DIR: root });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /No session starts with "nope"/);
});
