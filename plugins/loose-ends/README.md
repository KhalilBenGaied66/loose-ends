# Loose Ends

Finds the Claude Code conversations that are waiting on you: a question you never answered, a plan you never approved, an error you left, a step Claude handed to you. Local, zero tokens to scan, no network.

Install in Claude Code:

```
/plugin marketplace add KhalilBenGaied66/loose-ends
/plugin install loose-ends@loose-ends
```

The second command opens the plugin's page: choose **Install for you (user scope)**, then start a new session (or run `/reload-plugins`).

- **At session start:** one line, e.g. "Loose Ends: 4 conversations are waiting on you (1 in this project)". Shown again only after 3 hours or when the count changes.
- **`/loose-ends:scan`:** the list with ids (`--all` adds optional "want me to also…?" offers).
- **`/loose-ends:brief <id>`:** where it stopped, what's waiting on you, links you shared, and the `claude --resume` command.
- **`/loose-ends:page`:** a local scan page in your browser with copy buttons.

From a terminal (0 tokens): `node scripts/loose-ends.mjs [scan|brief|done|snooze|rate|stats|page|demo]`. Run `demo page` to try it on made-up sessions first.

Requires Node.js 18+. Without it, the plugin says once what to install and otherwise stays silent. It reads only `~/.claude/projects` (or `CLAUDE_CONFIG_DIR`) and keeps its own small state in `~/.loose-ends`. Set `LOOSE_ENDS_QUIET=1` to turn off the session-start line.

MIT licensed. Full documentation and measurements: see the repository README.
