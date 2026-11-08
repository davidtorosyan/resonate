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
