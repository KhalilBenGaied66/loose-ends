# Loose Ends

Finds the Claude Code conversations that are waiting on you: a question you never answered, a plan you never approved, an error you left, a step Claude handed to you. Local, zero tokens to scan, no network.

Install in Claude Code:

```
/plugin marketplace add KhalilBenGaied66/loose-ends
/plugin install loose-ends@loose-ends
```

The second command opens the plugin's page: choose **Install for you (user scope)**, then start a new session (or run `/reload-plugins`).

- **At session start:** one line, e.g. "Loose Ends: 4 conversations are waiting on you (1 in this project)". Shown again only after 3 hours or when the count changes.
- **`/loose-ends:scan`:** the numbered list with each one's status. In the desktop app, click a title to open that session; then reply `brief 1`, `done 2 3` or `snooze 1 7d` (`--all` adds optional "want me to also…?" offers).
- **`/loose-ends:brief <number or id>`:** a link to open it, where it stopped, what's waiting on you, links you shared, and the `claude --resume` command.
- **`/loose-ends:page`:** a local scan page in your browser with copy buttons.

From a terminal (0 tokens): `node scripts/loose-ends.mjs [scan|brief|done|snooze|rate|stats|page|demo]`. Run `demo page` to try it on made-up sessions first.

Requires Node.js 18+. Without it, the plugin says once what to install and otherwise stays silent. It reads `~/.claude/projects` (or `CLAUDE_CONFIG_DIR`), plus, in the Claude desktop app, the start of the app's own session records for each session's link, title and archived flag (`LOOSE_ENDS_NO_DESKTOP=1` turns that off). It keeps its own small state in `~/.loose-ends`. Set `LOOSE_ENDS_QUIET=1` to turn off the session-start line.

MIT licensed. Full documentation and measurements: see the repository README.
