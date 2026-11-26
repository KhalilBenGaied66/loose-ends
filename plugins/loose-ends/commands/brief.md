---
description: Resume brief for one loose end, with a link to open it
argument-hint: "<number or id>"
allowed-tools: Bash(bash *)
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" brief $ARGUMENTS --md`

If the output above is an error or a setup message, show it to the user as it is and stop.

Otherwise it is a resume brief for a conversation the user left. If its first line is an "Open it:" link, show that line first, exactly as written. Then, in 2 or 3 sentences, tell the user where it stopped and what decision or step is waiting on them, and suggest the single most sensible next step. If the brief lists links, say in one line what each one seems to be for, using only the URL and the brief (do not fetch them). Ask before doing any work. If there was no "Open it:" link and the work belongs in another project folder, give the `claude --resume` command from the brief instead of doing it here.
