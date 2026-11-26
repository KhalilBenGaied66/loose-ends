import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tempEnv, session } from "./helpers.mjs";
import { scan } from "../plugins/loose-ends/scripts/lib/scan.mjs";
import { classify, isDoneTitle } from "../plugins/loose-ends/scripts/lib/detect.mjs";
import { desktopSessions } from "../plugins/loose-ends/scripts/lib/desktop.mjs";
import { formatMarkdown } from "../plugins/loose-ends/scripts/lib/format.mjs";
import { readSession } from "../plugins/loose-ends/scripts/lib/reader.mjs";

const digestOf = (file) => readSession(file).digest;

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "plugins", "loose-ends", "scripts", "loose-ends.mjs");
const cli = (args, env = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env } });

test("done titles: the user closed it by renaming", () => {
  for (const t of ["AI Phishing Triage Assistant (DONE)", "AD Identity Attack Detection (DONE for now)", "✅ CV update", "Landing page - done", "Budget app [finished]"]) assert.ok(isDoneTitle(t), t);
  for (const t of ["Getting things done app", "Done button styling", "Make it done-able", "CV update with new projects"]) assert.ok(!isDoneTitle(t), t);
});

test("a long thank-you sign-off is closed; thanks plus a new request is not", () => {
  const { root } = tempEnv();
  const a = session(root).user("help me plan my certs", 30).ai("Here is a plan: Splunk lab first, then FortiGate.", 30)
    .user("thank you so much for your support. i will follow your plan and try to finish the splunk lab and the fortigate certification or lab this month", 29).write();
  const b = session(root).user("build the page", 30).ai("Done, the page is live.", 30)
    .user("Thanks. Now add the login page with Google sign-in", 29).write();
  assert.equal(classify(digestOf(a.file)).state, "closed");
  assert.equal(classify(digestOf(b.file)).state, "unanswered");
});

test("desktop records: link, sidebar title, archived ones hidden, renamed-DONE hidden", () => {
  const { root, base } = tempEnv();
  const open = session(root, { id: "aaaa1111-0000-0000-0000-000000000001" }).user("plan the launch", 30).ai("Should I post it Tuesday or Thursday?", 30).write();
  const archived = session(root, { id: "aaaa1111-0000-0000-0000-000000000002" }).user("x", 30).ai("Shall I deploy it?", 30).write();
  const renamed = session(root, { id: "aaaa1111-0000-0000-0000-000000000003" }).user("y", 30).ai("Shall I commit it?", 30).write();
  const cliOnly = session(root, { id: "aaaa1111-0000-0000-0000-000000000004" }).user("z", 30).ai("Shall I push it?", 30).write();

  // Fake desktop app store, same layout as the real one.
  const dir = path.join(base, "app", "claude-code-sessions", "acc", "org");
  fs.mkdirSync(dir, { recursive: true });
  const rec = (local, cli, title, isArchived) => fs.writeFileSync(path.join(dir, `${local}.json`), JSON.stringify({ sessionId: local, cliSessionId: cli, cwd: "C:\\w", isArchived, title, enabledMcpTools: { big: "x".repeat(20000) } }));
  rec("local_open", open.id, "Launch [plan] *now*", false);
  rec("local_arch", archived.id, "Deploy", true);
  rec("local_done", renamed.id, "Commit work (DONE)", false);
  fs.writeFileSync(path.join(dir, "local_broken.json"), "{not json");
  const desk = desktopSessions({ LOOSE_ENDS_DESKTOP_DIR: path.join(base, "app") });
  assert.equal(desk.get(open.id).hostId, "local_open");
  assert.equal(desk.get(archived.id).archived, true);

  const res = scan({ desktop: desk, track: false });
  const ids = res.items.map((i) => i.id).sort();
  assert.deepEqual(ids, [open.id, cliOnly.id].sort());
  const it = res.items.find((i) => i.id === open.id);
  assert.equal(it.title, "Launch [plan] *now*");
  assert.equal(it.hostId, "local_open");

  const withLinks = formatMarkdown(res, { links: true });
  assert.match(withLinks, /\*\*\[Launch \\\[plan\\\] \\\*now\\\*\]\(#local_open\)\*\*/);
  assert.match(withLinks, /Click a title/);
  assert.match(withLinks, /`done 2 3`/);
  const noLinks = formatMarkdown(res, { links: false });
  assert.doesNotMatch(noLinks, /#local_/);
  assert.match(noLinks, /^Reply with:/m);
});

test("cli: numbers refer to the last list; done and snooze take several", () => {
  const { root } = tempEnv();
  for (let i = 0; i < 3; i++) session(root).user(`task ${i}`, 30 + i).ai(`Shall I ship part ${i}?`, 30 + i).write();
  const list = cli(["scan", "--md"]);
  assert.match(list.stdout, /3 conversations are waiting on you/);
  const d = cli(["done", "1", "3"]);
  assert.equal(d.status, 0, d.stderr);
  assert.equal((d.stdout.match(/Marked done/g) || []).length, 2);
  const after = cli(["scan", "--md"]);
  assert.match(after.stdout, /1 conversation is waiting on you/);
  const s = cli(["snooze", "1", "7d"]);
  assert.match(s.stdout, /Snoozed for 7 days/);
  assert.match(cli(["scan", "--md"]).stdout, /Nothing is waiting on you/);
  const bad = cli(["brief", "9", "--md"]);
  assert.equal(bad.status, 0);
  assert.match(bad.stdout, /no item 9/);
});
