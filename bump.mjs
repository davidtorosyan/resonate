// Bump the app version: `node bump.mjs 55`.
//
// Sets the version badge on every page and puts `?v=55` on every local script / module
// address — the pages' <script src>, `import … from`, `import()`, `new Worker()`,
// `addModule()` and `importScripts()` — so a new page can only load the new code.
// GitHub Pages lets browsers reuse each file for 10 minutes, and modules are cached one by
// one: v54's sing.js with a cached v53 library.js failed to start (a missing export), and
// the Sing page showed nothing but its built-in song. Vendored code (omr/pdfjs, .mjs,
// template paths with quotes inside) is left alone.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const v = process.argv[2];
if (!/^\d+$/.test(v || "")) {
  console.error("usage: node bump.mjs <version number>");
  process.exit(1);
}
const root = new URL("./public/", import.meta.url).pathname;
const files = [
  ...readdirSync(root).filter((f) => /\.(html|js)$/.test(f)).map((f) => join(root, f)),
  ...readdirSync(join(root, "omr")).filter((f) => /\.js$/.test(f)).map((f) => join(root, "omr", f)),
  ...readdirSync(join(root, "oauth")).filter((f) => /\.(html|js)$/.test(f)).map((f) => join(root, "oauth", f)),
];
let changed = 0;
for (const file of files) {
  const before = readFileSync(file, "utf8");
  let s = before;
  if (file.endsWith(".html")) {
    s = s.replace(/(<span id="version"[^>]*>)v\d+(<\/span>)/, `$1v${v}$2`);
    s = s.replace(/(<script\b[^>]*\bsrc=")(?![a-z]+:\/\/)([^"?]+\.js)(\?v=\d+)?(")/g, `$1$2?v=${v}$4`);
  } else {
    s = s.replace(/(\bfrom\s+|\bimport\s*\(\s*|addModule\(\s*|new Worker\(\s*|importScripts\(\s*)(["'`])([^"'`?]+?\.js)(\?v=\d+)?\2/g, `$1$2$3?v=${v}$2`);
  }
  if (s !== before) {
    writeFileSync(file, s);
    changed++;
  }
}
console.log(`v${v}: ${changed} files updated`);
