---
description: Resume brief for one loose end, so you can pick it back up here
argument-hint: "<id>"
allowed-tools: Bash(bash *)
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" brief $ARGUMENTS --md`

If the output above is an error or a setup message, show it to the user as it is and stop.

Otherwise it is a resume brief for a conversation the user left. In 2 or 3 sentences, tell the user where it stopped and what decision or step is waiting on them, then suggest the single most sensible next step. If the brief lists links, say in one line what each one seems to be for, using only the URL and the brief (do not fetch them). Ask before doing any work. If the work belongs in another project folder, give the `claude --resume` command from the brief instead of doing it here.
