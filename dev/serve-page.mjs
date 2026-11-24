// Dev only: serves the scan page on http://127.0.0.1:8793, rebuilt on every request (no tracking side effects).
import http from "node:http";
import { scan, stats } from "../plugins/loose-ends/scripts/lib/scan.mjs";
import { renderPage } from "../plugins/loose-ends/scripts/lib/page.mjs";

const port = Number(process.env.PORT || 8793);
http.createServer((req, res) => {
  if (req.url !== "/" && !req.url.startsWith("/?")) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(renderPage(scan({ track: false, includeOffers: req.url.includes("all") }), stats()));
}).listen(port, "127.0.0.1", () => console.log(`scan page on http://127.0.0.1:${port}`));
