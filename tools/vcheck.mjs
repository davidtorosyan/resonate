// The version stamp bump.mjs writes. v54's failure: GitHub Pages lets a browser reuse each file for 10
// minutes, one module at a time, so v54's sing.js ran with a cached v53 library.js ("does not provide an
// export named 'saveClean'"). So:
//   • every page but the shell.html and tuner.html stubs carries the badge (<span id="version">vN</span>);
//   • every local <script src> and module address — import … from, export … from, import(), new Worker(),
//     addModule(), importScripts() — in public/ carries ?v=<badge> (the badge read from index.html).
// Vendored code is left out, as bump.mjs leaves it: vendor/, omr/pdfjs/, omr/tesseract/ (and template
// addresses with ${…} inside, and .mjs). A file bump.mjs doesn't reach (a new folder) shows up here.
//   node vcheck.mjs
import fs from 'node:fs';
import path from 'node:path';
import C from './lib/check.cjs';
const { ok, done } = C;
const PUBLIC = new URL('../public/', import.meta.url).pathname;
const VENDORED = ['vendor/', 'omr/pdfjs/', 'omr/tesseract/'];
const STUBS = ['shell.html', 'tuner.html']; // (no badge: they only forward to ./)

const badge = /<span id="version"[^>]*>v(\d+)<\/span>/.exec(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'))?.[1];
ok(!!badge, `index.html carries the badge (v${badge})`);

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(PUBLIC, path.join(dir, e.name)) + (e.isDirectory() ? '/' : '');
    if (VENDORED.some((v) => rel.startsWith(v))) continue;
    if (e.isDirectory()) walk(path.join(dir, e.name));
    else if (/\.(html|js)$/.test(e.name)) files.push(rel);
  }
})(PUBLIC);

const ADDR = /(\bfrom\s+|\bimport\s*\(\s*|addModule\(\s*|new Worker\(\s*|importScripts\(\s*)(["'`])([^"'`]+)\2/g;
const SRC = /<script\b[^>]*\bsrc=(["'])([^"']+)\1/g;
const local = (a) => !/^([a-z]+:)?\/\//i.test(a) && !a.includes('${') && /\.js(\?|#|$)/.test(a);
let pages = 0, addrs = 0;
for (const rel of files) {
  const s = fs.readFileSync(path.join(PUBLIC, rel), 'utf8');
  const bad = [];
  const want = (a) => { addrs++; if (!new RegExp(`\\.js\\?v=${badge}(?:[#&]|$)`).test(a)) bad.push(a); };
  for (const m of s.matchAll(ADDR)) if (local(m[3])) want(m[3]);
  if (rel.endsWith('.html')) {
    for (const m of s.matchAll(SRC)) if (local(m[2])) want(m[2]);
    if (!STUBS.includes(path.basename(rel))) {
      pages++;
      const v = /<span id="version"[^>]*>v(\d+)<\/span>/.exec(s)?.[1];
      ok(v === badge, `${rel}: badge v${v ?? '(none)'}`);
    }
  }
  if (bad.length) ok(false, `${rel}: ${bad.length} address(es) without ?v=${badge}: ${bad.slice(0, 5).join(', ')}`);
}
ok(addrs > 50, `${addrs} local addresses in ${files.length} files carry ?v=${badge}; ${pages} pages carry the badge`);
done();
