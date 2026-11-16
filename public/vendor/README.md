# Vendored code

## supabase-2.118.0.js

[supabase-js](https://github.com/supabase/supabase-js) 2.118.0, bundled into one ES module so
the site doesn't depend on a CDN at run time (and only the account page loads it — the other
pages read the saved session from `localStorage`, see `auth.js`).

Built with:

```
npm install --save-exact @supabase/supabase-js@2.118.0 esbuild@0.28.2
echo 'export { createClient } from "@supabase/supabase-js";' > entry.js
npx esbuild entry.js --bundle --format=esm --minify --platform=browser --target=es2020 --legal-comments=none --outfile=supabase.js
```

then the license header line on top. To upgrade: pick a release at least two weeks old, rebuild,
rename the file to the new version and change the import in `auth.js`.

Contents and licenses:

| package | version | license |
|---|---|---|
| @supabase/supabase-js, auth-js, postgrest-js, realtime-js, storage-js, functions-js | 2.118.0 | MIT (c) Supabase |
| @supabase/phoenix | 0.4.5 | MIT |
| iceberg-js | 0.8.1 | MIT |
| tslib | 2.8.1 | 0BSD |

## verovio-6.4.0/

[Verovio](https://github.com/rism-digital/verovio) 6.4.0 (tag `version-6.4.0`, commit
`cb5fcfa`; `getVersion()` says `6.4.0-33d1633`), the MusicXML engraver behind the Play page. `verovio-module.mjs` (the WebAssembly
build with its music fonts and data embedded; nothing else to fetch) and `verovio.mjs` (the
toolkit wrapper; no imports) are `dist/` of npm [`verovio@6.4.0`](https://www.npmjs.com/package/verovio/v/6.4.0)
(published 2026-10-30; tarball `sha512-xI10NuwOZ2VZHKG9i4HGaj7TXp7xgThNG2soVy1aDwH9O7oO/j5vdfrMO56EqB1XZ8WmhwXHprtUuFlgE3I7wg==`),
copied byte for byte — not bundled or minified:

| file | bytes | sha256 |
|---|---|---|
| verovio-module.mjs | 7,400,681 | `e7e2d3940ce4c6b3d423693724c8d7c6aaa3a6b74562d172ec511e83700c6309` |
| verovio.mjs | 25,815 | `0659cecb1f4c70ab47773f51f4bfd30a7c17273a0b8075cb4dc6407974ad1338` |

Loaded only by the Play page, with a dynamic import of both files:

```js
const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([
  import("./vendor/verovio-6.4.0/verovio-module.mjs"), import("./vendor/verovio-6.4.0/verovio.mjs")]);
const tk = new VerovioToolkit(await createVerovioModule());
```

`.mjs` in a versioned folder on purpose: `bump.mjs` only puts `?v=` on `.js` addresses, so an app
release doesn't make every device download 7 MB again (GitHub Pages answers a revalidation with
304).

Licenses:

| what | license | text |
|---|---|---|
| Verovio (both files) | LGPL-3.0-only, (c) Laurent Pugin and others | `COPYING.LESSER`, and the GPL-3.0 it builds on, `COPYING` (both from the Verovio repository at the tag) |
| music fonts embedded in the module: Leipzig, Bravura, Leland, Gootville, Petaluma | SIL OFL 1.1 | `OFL.txt` (with each font's copyright line) |
| text font embedded in the module: Liberation Serif 1.04 (used only with the option `fontTextLiberation`, which Play doesn't set) | Liberation font license: GPL-2.0 with a font exception | `Liberation-LICENSE.txt`, `GPL-2.0.txt` |

LGPL-3.0: Verovio is shipped as separate, unmodified files, loaded at run time; you may replace
them with another build of the same version (e.g. one you compiled from the tag's source) and the
page will use it. The source is at https://github.com/rism-digital/verovio/tree/version-6.4.0.
Verovio's fonts/README.md says all its fonts are under the OFL; the embedded Liberation Serif's own
name table says version 1.04 (2007), the GPL-licensed 1.x series, so its license is kept here too.

Don't bundle it with esbuild (8.3 MB, and a modified file complicates the LGPL). To upgrade: pick a
release at least two weeks old, copy `dist/verovio-module.mjs` and `dist/verovio.mjs` from the npm
package into a new `verovio-<version>/` folder with the license files (re-check which fonts the module
embeds: `grep -ao '/data/[A-Za-z]*\.css' verovio-module.mjs`), change the two import addresses in
play.js, update this section and delete the old folder.
