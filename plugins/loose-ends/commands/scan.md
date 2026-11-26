---
description: List the conversations that are waiting on you, with a link to open each one (local scan, 0 tokens to build)
argument-hint: "[--all]"
allowed-tools: Bash(bash *)
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" scan --md $ARGUMENTS`

Show the output above to the user exactly as it is: keep every link, number, id and line, and add nothing before or after it. Then wait for their reply. Do not run anything else until they answer.

Numbers in their reply refer to the list above. Handle these replies, running only the command shown:

- `brief N` (or "pick up N", "what about 2"): run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" brief N --md`. If its first line is an "Open it:" link, show that link first, exactly as written. Then say in 2-3 sentences where that session stopped and what it needs from the user, give the "Continue in a terminal" command only if there was no link, and ask whether to pick it up here.
- `open N`: give item N's title link from the list above. If it has no link, run the brief command above and give its "Continue in a terminal" command.
- `done N M…`: run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" done N M…` and confirm in one line.
- `snooze N [7d]`: run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" snooze N 7d` (the days are optional, default one day) and confirm in one line.

Never open, edit or continue the listed sessions yourself.
