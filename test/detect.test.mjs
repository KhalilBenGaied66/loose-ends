import test from "node:test";
import assert from "node:assert/strict";
import { tempEnv, session } from "./helpers.mjs";
import { readSession } from "../plugins/loose-ends/scripts/lib/reader.mjs";
import { classify, finalQuestion, kindOfQuestion } from "../plugins/loose-ends/scripts/lib/detect.mjs";

const { root } = tempEnv();
const verdict = (s) => classify(readSession(s.write().file).digest);

test("AI ends on an either/or question -> decision waiting", () => {
  const c = verdict(session(root).user("Plan the launch").ai("Here is the plan.\n\nShould I publish it today, or would you rather wait for the video?"));
  assert.equal(c.state, "waiting");
  assert.equal(c.kind, "decision");
  assert.match(c.question, /publish it today/);
});

test("imperative question is an approval, 'want me to' is an optional offer", () => {
  assert.equal(kindOfQuestion("Start M1 while you install Docker?"), "approval");
  assert.equal(kindOfQuestion("Want me to also add tests?"), "offer");
  assert.equal(kindOfQuestion("Should I install OBS Studio with winget?"), "approval");
});

test("a question buried mid-answer is not a hand-off", () => {
  const c = verdict(session(root).user("Explain X").ai("Why does this matter? Because caching.\n\nIt matters for three reasons.\n\nFirst, speed.\n\nSecond, cost.\n\nThat's the summary."));
  assert.equal(c.state, "finished");
});

test("quoted text ending in ? is not a question to the user", () => {
  assert.equal(finalQuestion('The title card reads:\n\nText: "WHO LIVES HERE?"'), "");
});

test("code blocks are ignored when looking for the final question", () => {
  assert.equal(finalQuestion("Done.\n\n```js\nconst ok = a ? b : c?\n```"), "");
});

test("'thanks' at the end closes the conversation", () => {
  assert.equal(verdict(session(root).user("fix it").ai("Fixed. Want me to add tests?").user("thanks!")).state, "closed");
});

test("user's last message is an error with no reply -> left broken", () => {
  const c = verdict(session(root).user("build it").ai("Built.").user("Traceback (most recent call last): ValueError"));
  assert.equal(c.state, "broken");
});

test("interrupted by the user", () => {
  assert.equal(verdict(session(root).user("do a big refactor").ai("Starting.").user("[Request interrupted by user]")).state, "interrupted");
});

test("API error / usage limit at the end", () => {
  const c = verdict(session(root).user("go").ai("Claude usage limit reached", 10, { isApiErrorMessage: true }));
  assert.equal(c.state, "interrupted");
  assert.match(c.question, /usage limit/);
});

test("session that died mid-task (tool call without a reply)", () => {
  assert.equal(verdict(session(root).user("run tests").tool("Bash", { command: "npm test" })).state, "interrupted");
});

test("desktop wrap_up question counts as waiting, even when phrased as an offer", () => {
  const s = session(root).user("brainstorm").ai("Here's the idea.").tool("mcp__ccd_turn__wrap_up", { recap: "r", ask: "Want me to build the MVP here?" }).result().ai("Closing message.");
  const c = verdict(s);
  assert.equal(c.state, "waiting");
  assert.equal(c.kind, "approval");
  assert.match(c.question, /build the MVP/);
});

test("a wrap_up question the user already answered is not waiting", () => {
  const s = session(root).user("brainstorm").tool("mcp__ccd_turn__wrap_up", { recap: "r", ask: "Build it?" }).result().ai("Done.")
    .user("yes build it").ai("Built and tested. All 12 tests pass.");
  assert.equal(verdict(s).state, "finished");
});

test("AskUserQuestion with no answer -> decision waiting; answered -> not", () => {
  const open = session(root).user("pick a db").tool("AskUserQuestion", { questions: [{ question: "Postgres or SQLite?" }] });
  assert.equal(verdict(open).kind, "decision");
  const answered = session(root).user("pick a db").tool("AskUserQuestion", { questions: [{ question: "Postgres or SQLite?" }] }).result().ai("Going with SQLite. Done.");
  assert.equal(verdict(answered).state, "finished");
});

test("task list replay: open steps -> half done", () => {
  const s = session(root).user("ship v1")
    .tool("mcp__ccd_turn__update_plan", { items: [{ content: "Write code", status: "in_progress" }, { content: "Write tests", status: "pending" }, { content: "Publish", status: "pending" }] }).result()
    .tool("mcp__ccd_turn__update_plan", { advance: true }).result()
    .ai("Code is written. Moving on to tests next session.");
  const c = verdict(s);
  assert.equal(c.state, "half_done");
  assert.match(c.question, /2 step\(s\) left: Write tests/);
});

test("harness/automated messages and sub-agent lines are ignored", () => {
  const s = session(root).user("real question").ai("Real answer. Should I ship it?")
    .user("<side-sessions-event>a session finished</side-sessions-event>")
    .raw({ type: "user", isSidechain: true, sessionId: "x", message: { role: "user", content: "sidechain chatter" } });
  const c = verdict(s);
  assert.equal(c.state, "waiting");
});

test("hand-off without a question mark: needs your go-ahead -> approval", () => {
  const c = verdict(session(root).user("benchmark it").ai("Stopping here. The untried lever is the 20-step path (~70 min), and I'd want your go-ahead before spending that."));
  assert.equal(c.state, "waiting");
  assert.equal(c.kind, "approval");
});

test("'waiting for your render' is about a program, not the user", () => {
  assert.equal(finalQuestion("The downloader is paused. It's still waiting for your video render to finish."), "");
});

test("a step handed to the user -> your move", () => {
  const c = verdict(session(root).user("fix the zip").ai("Fixed. To give buyers the fix, open the Content tab on Gumroad and upload the new zip again."));
  assert.equal(c.kind, "your_move");
});

test("'later' in someone else's sentence is not a promise; 'I'll test it tomorrow' is", () => {
  assert.equal(verdict(session(root).user("hook: you get paid days later").ai("Updated the hook.")).state, "finished");
  assert.equal(verdict(session(root).user("ok I'll test it tomorrow").ai("Sounds good. The build is in dist/.")).state, "promised");
  assert.equal(verdict(session(root).user("Nice, I'll test it on my phone tomorrow").ai("Sounds good.")).state, "promised");
});

test("throwaway session ending on a greeting is ignored", () => {
  assert.equal(verdict(session(root).user("Reply OK").ai("OK. What would you like to work on?")).state, "finished");
});

test("a session that only ran /loose-ends:scan never flags itself", () => {
  const viaTag = session(root).user("<command-name>/loose-ends:scan</command-name>\n<command-args></command-args>").ai("14 waiting. Which one do you want to pick up?");
  assert.equal(verdict(viaTag).state, "finished");
  assert.equal(verdict(session(root).user("/loose-ends:scan").ai("Which one do you want to pick up?")).state, "finished");
});

test("empty session (no human message) is ignored", () => {
  assert.equal(verdict(session(root).ai("hello")).state, "empty");
});
