import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");
const manifest = JSON.parse(await read("manifest.json"));
const pkg = JSON.parse(await read("package.json"));
const lock = JSON.parse(await read("package-lock.json"));
const versions = JSON.parse(await read("versions.json"));
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.version, lock.version);
assert.equal(manifest.version, lock.packages[""].version);
assert.equal(manifest.isDesktopOnly, false);
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert(!manifest.id.includes("obsidian"));
assert(manifest.description.length <= 250 && manifest.description.endsWith("."));

const result = await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: ["main.ts"], bundle: true, platform: "browser", external: ["obsidian"],
  format: "cjs", target: "es2018", write: false, metafile: true,
  minify: false, sourcemap: false, treeShaking: true
});
const externalImports = Object.values(result.metafile.outputs)
  .flatMap(output => output.imports).filter(item => item.external);
assert(externalImports.every(item => item.path === "obsidian"), "Unexpected runtime import");
assert(Object.keys(result.metafile.inputs).every(path => !path.includes("node_modules")),
  "Runtime dependencies must be reviewed before shipping");
const bundle = await read("main.js");
assert.equal(bundle, result.outputFiles[0].text, "main.js is stale; run npm run build");
new Script(bundle, { filename: "main.js" });
for (const file of ["README.md", "LICENSE", "styles.css"]) assert((await read(file)).trim());
assert(!/AIza[\w-]{30,}|gh[pousr]_[\w]{25,}|-----BEGIN .*PRIVATE KEY-----/.test(bundle),
  "Possible credential in the release bundle");
console.log(`Release ${manifest.version}: metadata, reproducible browser bundle, imports and credential scan passed.`);

