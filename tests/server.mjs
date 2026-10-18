// A tiny static server for the tests. `overrides` lets a test serve modified
// content for a path without touching the file on disk, so a killed test run
// can never leave the repo half-edited.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".css": "text/css",
};

export async function serve(root) {
  const overrides = new Map();
  const server = http.createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path.endsWith("/")) path += "index.html";
    if (overrides.has(path)) {
      res.writeHead(200, { "content-type": TYPES[extname(path)] || "text/plain", "cache-control": "no-store" });
      res.end(overrides.get(path));
      return;
    }
    const file = normalize(join(root, path));
    if (!file.startsWith(normalize(root) + sep)) { res.writeHead(403); res.end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch (e) {
      res.writeHead(404); res.end("not found");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return {
    url: "http://localhost:" + port + "/",
    overrides,
    close: () => new Promise((r) => server.close(r)),
  };
}
