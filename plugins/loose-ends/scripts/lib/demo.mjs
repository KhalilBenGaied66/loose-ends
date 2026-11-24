// Demo data: made-up Claude Code sessions in the real JSONL shape, for screenshots and first-look tries.
// Everything here is fictional. It is written to a temp folder, never into ~/.claude.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const H = 3600e3;

function writer(root, project, cwd) {
  const dir = path.join(root, project);
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  return (id, title, turns) => {
    const lines = [{ type: "custom-title", customTitle: title, sessionId: id }];
    for (const [role, hoursAgo, body] of turns) {
      const base = { sessionId: id, cwd, isSidechain: false, uuid: `${id}-${++n}`, timestamp: new Date(Date.now() - hoursAgo * H).toISOString() };
      if (role === "user") lines.push({ ...base, type: "user", message: { role: "user", content: body } });
      else if (role === "ai") lines.push({ ...base, type: "assistant", message: { role: "assistant", content: [{ type: "text", text: body }] } });
      else if (role === "err") lines.push({ ...base, type: "assistant", isApiErrorMessage: true, message: { role: "assistant", content: [{ type: "text", text: body }] } });
      else if (role === "tool") lines.push({ ...base, type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: `${id}-t${n}`, name: body.name, input: body.input }] } });
      else if (role === "result") lines.push({ ...base, type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `${id}-t${n - 1}`, content: "ok" }] } });
    }
    fs.writeFileSync(path.join(dir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  };
}

const P = (name) => (process.platform === "win32" ? `C:\\Users\\demo\\projects\\${name}` : `/home/demo/projects/${name}`);

/** Creates the demo folder and returns { root, home }. */
export function buildDemo(base = path.join(os.tmpdir(), "loose-ends-demo")) {
  fs.rmSync(base, { recursive: true, force: true });
  const root = path.join(base, "projects");
  const home = path.join(base, "home");

  writer(root, "portfolio-site", P("portfolio-site"))("d1a7c0de-0001", "Landing page headline", [
    ["user", 30, "Write three headline options for my portfolio landing page"],
    ["ai", 30, "Here are three options, with the trade-offs of each.\n\nKeep the short one (\"I build tools people actually use\"), or go with the longer, benefit-led one?"],
  ]);
  writer(root, "budget-app", P("budget-app"))("b4d6e700-0002", "Recurring expenses feature", [
    ["user", 52, "Add recurring expenses (monthly rent, subscriptions) to the budget app"],
    ["ai", 52, "The model, API and UI are done and the tests pass. The last step changes the live database.\n\nShould I run the migration on the staging copy first?"],
  ]);
  writer(root, "thesis", P("thesis"))("7e515000-0003", "Literature review, chapter 2", [
    ["user", 75, "Help me structure chapter 2. Sources: https://arxiv.org/abs/2401.00001 and https://doi.org/10.1000/demo"],
    ["ai", 75, "I drafted the outline and marked three claims that need checking against the papers.\n\nOnce you've checked those three sources, I'll merge them into the chapter."],
  ]);
  writer(root, "weekend-game", P("weekend-game"))("6a3e0000-0004", "Jump physics tuning", [
    ["user", 98, "Make the jump feel snappier"],
    ["ai", 98, "Raised gravity on the way down and added coyote time. Try it now."],
    ["user", 97, "Still not working: the player falls through the floor after the second jump"],
  ]);
  writer(root, "newsletter", P("newsletter"))("ae115e77-0005", "Issue #12 draft", [
    ["user", 20, "Turn my notes into this week's newsletter issue"],
    ["ai", 20, "Draft is ready: 640 words, three sections, one call to action.\n\nPublish it now, or schedule it for Tuesday at 9 am?"],
  ]);
  writer(root, "data-pipeline", P("data-pipeline"))("da7a0000-0006", "Nightly import job", [
    ["user", 120, "Rewrite the nightly CSV import so it can resume after a crash"],
    ["ai", 120, "Starting with the checkpoint table."],
    ["err", 120, "Claude usage limit reached. Your limit resets at 3 am."],
  ]);
  writer(root, "job-hunt", P("job-hunt"))("10b5ea7c-0007", "Cover letter, Berlin role", [
    ["user", 150, "Draft a cover letter for this role: https://jobs.example.com/berlin-ml-engineer"],
    ["ai", 150, "Here's a first draft. It reads stronger if it leads with one project.\n\nWhich of your two projects should lead the letter: the search engine or the voice assistant?"],
  ]);
  writer(root, "home-server", P("home-server"))("5e7e0000-0008", "Home server setup", [
    ["user", 200, "Set up my home server: backups, VPN, media, monitoring, updates"],
    ["tool", 200, { name: "TodoWrite", input: { todos: [
      { content: "Automatic backups", status: "completed" },
      { content: "WireGuard VPN", status: "completed" },
      { content: "Media server", status: "in_progress" },
      { content: "Monitoring dashboard", status: "pending" },
      { content: "Automatic updates", status: "pending" },
    ] } }],
    ["result", 200, null],
    ["ai", 200, "Backups and the VPN are working. The media server is half configured: the library paths are set, transcoding isn't yet."],
  ]);
  writer(root, "recipe-app", P("recipe-app"))("2ec1be00-0009", "Offline mode", [
    ["user", 110, "Make the recipe app work offline"],
    ["ai", 110, "Done: recipes are cached and edits sync when you're back online."],
    ["user", 109, "Nice, I'll test it on my phone tomorrow"],
    ["ai", 109, "Sounds good. The build is in dist/."],
  ]);
  // Finished conversations, to show it stays quiet when you closed the loop.
  writer(root, "portfolio-site", P("portfolio-site"))("f1e1d000-0010", "Fix the contact form", [
    ["user", 40, "The contact form doesn't send"],
    ["ai", 40, "Fixed: the form posted to the old endpoint. Sent a test message, it arrived."],
    ["user", 39, "perfect, thanks!"],
  ]);
  writer(root, "budget-app", P("budget-app"))("f1e1d000-0011", "Dark mode", [
    ["user", 60, "Add dark mode"],
    ["ai", 60, "Dark mode is in, following the system setting. Checked every screen in both themes."],
  ]);
  return { root, home };
}
