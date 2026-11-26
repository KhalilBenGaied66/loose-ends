// Claude desktop app (Code tab) support: each desktop session has a small record that maps the
// Claude Code session id to the app's own session id, title and archived flag. With it, the list can
// link every item straight to its session ("[title](#local_…)" opens it in the app's sidebar).
// This reads an undocumented local format, so every step is best-effort: if anything is missing or
// changes shape, Loose Ends simply shows no links.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HEAD = 8192; // the fields we need sit at the start of each record; some records are ~1 MB

function candidateDirs(env) {
  const dirs = [];
  if (env.LOOSE_ENDS_DESKTOP_DIR) dirs.push(env.LOOSE_ENDS_DESKTOP_DIR);
  // The app tells the Claude Code it runs where its own data lives.
  const exec = env.CLAUDE_CODE_EXECPATH || "";
  const m = exec.match(/^(.*?)[\\/]claude-code[\\/]/);
  if (m) dirs.push(m[1]);
  const h = os.homedir();
  if (env.APPDATA) dirs.push(path.join(env.APPDATA, "Claude"));
  if (env.LOCALAPPDATA) {
    const cd = path.join(env.LOCALAPPDATA, "Claude-Data");
    try { for (const d of fs.readdirSync(cd)) dirs.push(path.join(cd, d)); } catch { /* not there */ }
  }
  dirs.push(path.join(h, "Library", "Application Support", "Claude"));
  dirs.push(path.join(h, ".config", "Claude"));
  return [...new Set(dirs)];
}

function readHead(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(HEAD);
    const n = fs.readSync(fd, buf, 0, HEAD, 0);
    return buf.subarray(0, n).toString("utf8");
  } catch { return ""; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ } }
}

const str = (head, key) => {
  const m = head.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (!m) return "";
  try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
};

/** Map of Claude Code session id -> { hostId, title, archived } for this computer's desktop sessions. */
export function desktopSessions(env = process.env) {
  const map = new Map();
  if (env.LOOSE_ENDS_NO_DESKTOP === "1") return map;
  for (const base of candidateDirs(env)) {
    const root = path.join(base, "claude-code-sessions");
    let accounts;
    try { accounts = fs.readdirSync(root); } catch { continue; }
    for (const acc of accounts) {
      let orgs;
      try { orgs = fs.readdirSync(path.join(root, acc)); } catch { continue; }
      for (const org of orgs) {
        const dir = path.join(root, acc, org);
        let files;
        try { files = fs.readdirSync(dir); } catch { continue; }
        for (const f of files) {
          if (!/^local_[\w-]+\.json$/.test(f)) continue;
          const head = readHead(path.join(dir, f));
          const cli = str(head, "cliSessionId");
          const hostId = str(head, "sessionId") || f.replace(/\.json$/, "");
          if (!cli || !hostId.startsWith("local_")) continue;
          map.set(cli, {
            hostId,
            title: str(head, "title"),
            archived: /"isArchived"\s*:\s*true/.test(head),
          });
        }
      }
    }
  }
  return map;
}

/** Links only work where the desktop app renders the chat. */
export function inDesktopApp(env = process.env) {
  return env.CLAUDE_CODE_ENTRYPOINT === "claude-desktop" || env.LOOSE_ENDS_LINKS === "1";
}
