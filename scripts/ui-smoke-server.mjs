import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = new URL("../", import.meta.url);
const port = Number(process.env.AI_FLASHCARD_SMOKE_PORT || 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("AI_FLASHCARD_SMOKE_PORT must be an integer from 1024 to 65535.");
}

const bundle = await build({
  absWorkingDir: fileURLToPath(projectRoot),
  entryPoints: ["test-support/ui-smoke/app.ts"],
  alias: {
    obsidian: fileURLToPath(new URL("test-support/ui-smoke/obsidian.ts", projectRoot))
  },
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2020",
  write: false
});

// Only these in-memory, explicitly listed resources can be requested.
const resources = new Map([
  ["/", ["text/html; charset=utf-8", await readFile(new URL("test-support/ui-smoke/index.html", projectRoot))]],
  ["/app.js", ["text/javascript; charset=utf-8", bundle.outputFiles[0].contents]],
  ["/styles.css", ["text/css; charset=utf-8", await readFile(new URL("styles.css", projectRoot))]]
]);

const server = createServer((request, response) => {
  const resource = resources.get(request.url);
  if (request.method !== "GET" || !resource) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": resource[0],
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  });
  response.end(resource[1]);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`UI simulation only: http://127.0.0.1:${port}`);
  console.log("No real Gemini requests or vault writes. Restart after source edits.");
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close());
}

