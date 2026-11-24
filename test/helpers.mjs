// Builds fake Claude Code session files in a temp folder, in the same JSONL shape Claude Code writes.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let n = 0;
export function tempEnv() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "loose-ends-test-"));
  const root = path.join(base, "projects");
  const home = path.join(base, "home");
  fs.mkdirSync(root, { recursive: true });
  process.env.LOOSE_ENDS_HOME = home;
  process.env.LOOSE_ENDS_CLAUDE_DIR = root;
  return { base, root, home };
}

export const HOUR = 3600e3;

/** A tiny session builder. Each call appends one entry; `at` is hours ago. */
export function session(root, { id = `s${++n}-0000-aaaa`, cwd = "C:\\work\\demo", project = "C--work-demo" } = {}) {
  const entries = [];
  let uid = 0;
  const base = (type, hoursAgo, extra) => ({
    type, sessionId: id, cwd, isSidechain: false, uuid: `u${++uid}`,
    timestamp: new Date(Date.now() - hoursAgo * HOUR).toISOString(), ...extra,
  });
  const api = {
    id,
    user(text, hoursAgo = 10, extra = {}) { entries.push(base("user", hoursAgo, { message: { role: "user", content: text }, ...extra })); return api; },
    ai(text, hoursAgo = 10, extra = {}) { entries.push(base("assistant", hoursAgo, { message: { role: "assistant", content: [{ type: "text", text }] }, ...extra })); return api; },
    tool(name, input, hoursAgo = 10, toolId = `t${++uid}`) { entries.push(base("assistant", hoursAgo, { message: { role: "assistant", content: [{ type: "tool_use", id: toolId, name, input }] } })); api.lastToolId = toolId; return api; },
    result(toolId = api.lastToolId, hoursAgo = 10) { entries.push(base("user", hoursAgo, { message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolId, content: "ok" }] } })); return api; },
    raw(obj) { entries.push(obj); return api; },
    title(t) { entries.push({ type: "custom-title", customTitle: t, sessionId: id }); return api; },
    write() {
      const dir = path.join(root, project);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${id}.jsonl`);
      fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
      api.file = file;
      return api;
    },
  };
  return api;
}
