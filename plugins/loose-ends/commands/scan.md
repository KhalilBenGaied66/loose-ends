---
description: List the conversations that are waiting on you (local scan, 0 tokens to build)
argument-hint: "[--all]"
allowed-tools: Bash(bash *)
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" scan --md $ARGUMENTS`

Show the output above to the user exactly as it is, without commentary. If it is a list, ask in one short line which one they want to pick up, or whether to mark some as done. Do not run anything else until they answer.

- To pick one up: run `/loose-ends:brief <id>`.
- To clear one: run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" done <id>` (or `snooze <id> <days>`).
