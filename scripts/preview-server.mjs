import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Serves `dist/client` under `/toyota-showroom/*`, mirroring how GitHub Pages actually serves
 * this project (`vite.config.ts`'s `base: "/toyota-showroom/"`) — every asset URL the app emits
 * is already prefixed for that sub-path, so serving `dist/client` at the domain root (as a plain
 * `http.server`/`serve` invocation would) 404s every stylesheet, script, and catalog fixture.
 * Used by `playwright.config.ts`'s `webServer` for e2e/visual tests, which need the real site,
 * not a dev server — `vinext dev` fails to even boot routes in this sandbox (its startup
 * `Request.cf` fetch has no network egress here; see docs/INTEGRATION_GUIDE.md's E2E section).
 */

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "client");
const base = "/toyota-showroom";
const port = Number(process.env.PORT ?? 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".rsc": "text/x-component; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
};

function contentType(filePath) {
  return MIME[path.extname(filePath)] ?? "application/octet-stream";
}

/** `trailingSlash: true` (next.config.mjs) means every route is a directory with its own index.html. */
async function resolveFile(urlPath) {
  const candidates = urlPath.endsWith("/")
    ? [path.join(root, urlPath, "index.html")]
    : [path.join(root, urlPath), path.join(root, `${urlPath}.html`), path.join(root, urlPath, "index.html")];

  for (const candidate of candidates) {
    if (!candidate.startsWith(root)) continue; // no path traversal out of dist/client
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (!url.pathname.startsWith(base)) {
    res.writeHead(404).end("Not found (outside base path)");
    return;
  }

  const relative = url.pathname.slice(base.length) || "/";
  const file = await resolveFile(relative);
  if (!file) {
    const notFound = path.join(root, "404.html");
    try {
      const body = await readFile(notFound);
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" }).end(body);
    } catch {
      res.writeHead(404).end("Not found");
    }
    return;
  }

  const body = await readFile(file);
  res.writeHead(200, { "Content-Type": contentType(file) }).end(body);
});

server.listen(port, () => {
  console.log(`[preview-server] serving ${root} at http://localhost:${port}${base}/`);
});
