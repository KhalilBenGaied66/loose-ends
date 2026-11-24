// The local "scan page": one static HTML file in ~/.loose-ends, opened in the default browser. No network.
import { LABELS } from "./detect.mjs";
import { ago, buildBrief, headline } from "./format.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const TONE = { decision: "hot", approval: "hot", broken: "hot", question: "warm", interrupted: "warm", unanswered: "warm", half_done: "cool", promised: "cool", offer: "cool" };

export function renderPage(res, st, { now = Date.now() } = {}) {
  const n = res.items.length;
  const byProject = {};
  for (const it of res.items) byProject[it.project] = (byProject[it.project] || 0) + 1;
  const topProjects = Object.entries(byProject).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const oldest = res.items.reduce((m, it) => Math.max(m, it.idleHours), 0);

  const cards = res.items.map((it, i) => {
    const brief = buildBrief(it.session, it, { now });
    return `<article class="card ${TONE[it.kind] || "warm"}">
  <header><span class="badge">${esc(LABELS[it.kind] || it.kind)}</span><span class="meta">${esc(it.project)} · ${esc(ago(it.idleHours))} · <code>${esc(it.short)}</code></span></header>
  <h3>${esc(it.title)}</h3>
  ${it.question ? `<blockquote>${esc(it.question)}</blockquote>` : ""}
  ${it.links.length ? `<p class="links">${it.links.map((l) => `<a href="${esc(l)}" rel="noreferrer noopener" target="_blank">${esc(l.replace(/^https?:\/\//, "").slice(0, 60))}</a>`).join("")}</p>` : ""}
  <div class="actions">
    <button data-copy="b${i}">Copy resume brief</button>
    <button data-copy="r${i}" class="ghost">Copy resume command</button>
    <button data-copy="d${i}" class="ghost">Copy "mark done"</button>
  </div>
  <textarea hidden id="b${i}">${esc(brief)}</textarea>
  <textarea hidden id="r${i}">${esc(`cd "${it.cwd || "."}" && claude --resume ${it.id}`)}</textarea>
  <textarea hidden id="d${i}">${esc(`loose-ends done ${it.short}`)}</textarea>
</article>`;
  }).join("\n");

  const resumeRate = st.measurable48 ? Math.round((100 * st.resumed48) / st.measurable48) : null;
  const projects = Object.keys(byProject).length;
  const busiest = topProjects[0] && topProjects[0][1] >= 2
    ? { big: topProjects[0][0], small: `most loose ends (${topProjects[0][1]})` }
    : { big: String(projects || "–"), small: projects === 1 ? "project with loose ends" : "projects with loose ends" };

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Loose Ends</title>
<style>
:root{--bg:#f6f4ef;--fg:#1d1b17;--mut:#6b655b;--card:#fff;--line:#e4dfd4;--hot:#d9480f;--warm:#b7791f;--cool:#2f6f73;--btn:#1d1b17;--btnfg:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#141311;--fg:#f1ede4;--mut:#a39c8f;--card:#1e1c19;--line:#34302a;--hot:#ff8a4c;--warm:#e3b341;--cool:#6cc3c8;--btn:#f1ede4;--btnfg:#141311}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:860px;margin:0 auto;padding:40px 16px 80px}
.kicker{letter-spacing:.12em;text-transform:uppercase;font-size:12px;color:var(--mut);margin:0}
h1{font-size:clamp(34px,7vw,60px);line-height:1.05;margin:8px 0 12px;font-weight:800}
h1 .n{color:var(--hot)}
.sub{color:var(--mut);margin:0 0 28px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:0 0 32px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.stat b{display:block;font-size:24px}.stat span{color:var(--mut);font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--warm);border-radius:12px;padding:16px 18px;margin:0 0 14px}
.card.hot{border-left-color:var(--hot)}.card.cool{border-left-color:var(--cool)}
.card header{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px;color:var(--mut)}
.badge{font-weight:700;color:var(--fg)}
.card h3{margin:6px 0;font-size:18px;overflow-wrap:anywhere}
blockquote{margin:8px 0;padding:8px 12px;border-radius:8px;background:color-mix(in srgb,var(--line) 45%,transparent);overflow-wrap:anywhere}
.links a{display:inline-block;margin:0 10px 4px 0;color:var(--cool);font-size:14px;overflow-wrap:anywhere}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
button{font:inherit;font-size:14px;border-radius:8px;padding:7px 12px;border:1px solid var(--btn);background:var(--btn);color:var(--btnfg);cursor:pointer}
button.ghost{background:transparent;color:var(--fg);border-color:var(--line)}
footer{color:var(--mut);font-size:13px;margin-top:36px}
.empty{font-size:20px}
</style></head><body><main>
<p class="kicker">Loose Ends · local scan · ${esc(new Date(now).toLocaleString())}</p>
<h1>${n ? `You left your AI on read <span class="n">${n}</span> time${n === 1 ? "" : "s"}.` : "Nothing is waiting on you."}</h1>
<p class="sub">${esc(headline(n))} Scanned ${res.scanned} Claude Code sessions on this computer in ${res.ms} ms. 0 tokens used, nothing uploaded.</p>
<section class="stats">
  <div class="stat"><b>${n}</b><span>waiting on you</span></div>
  <div class="stat"><b>${esc(n ? ago(oldest).replace(" ago", "") : "–")}</b><span>oldest loose end</span></div>
  <div class="stat"><b>${esc(busiest.big)}</b><span>${esc(busiest.small)}</span></div>
  <div class="stat"><b>${resumeRate === null ? "–" : `${resumeRate}%`}</b><span>picked back up within 48 h${resumeRate === null ? " (measured from now on)" : ""}</span></div>
</section>
${cards || `<p class="empty">Every conversation ended with you. Nice.</p>`}
<footer>Loose Ends reads your session files locally and never sends them anywhere. Rate a reminder with <code>loose-ends rate &lt;id&gt; up|down</code> to make it smarter.</footer>
</main>
<script>
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-copy]"); if (!b) return;
  const t = document.getElementById(b.dataset.copy).value;
  try { await navigator.clipboard.writeText(t); }
  catch { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
  const old = b.textContent; b.textContent = "Copied ✓"; setTimeout(() => (b.textContent = old), 1400);
});
</script>
</body></html>`;
}
