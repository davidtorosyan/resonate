// constants.sh (the web -constant s every native run passes) = the worker's own (public/omr/omr-worker.js), less
// the two that only bound time (Main.sheetStepTimeOut: a step's timeout; OmrExecutors.graceDelay: a shutdown's
// grace) — a native A/B or a resume with other constants reads the page differently from the site.
//   node accuracy/constcheck.mjs      (regress.sh fast)
import fs from 'node:fs';
import C from '../lib/check.cjs';
const { ok, done } = C;
const TIME_ONLY = ['org.audiveris.omr.Main.sheetStepTimeOut', 'org.audiveris.omr.util.OmrExecutors.graceDelay'];
const sh = fs.readFileSync(new URL('constants.sh', import.meta.url), 'utf8');
const line = /^ACC_CONSTANTS="([^"]*)"/m.exec(sh)?.[1] ?? '';
const native = [...line.matchAll(/-constant\s+(\S+)/g)].map((m) => m[1]).sort();
const worker = fs.readFileSync(new URL('../../public/omr/omr-worker.js', import.meta.url), 'utf8');
const web = [...worker.matchAll(/'-constant',\s*[`'"]([^`'"]+)[`'"]/g)].map((m) => m[1]).filter((c) => !TIME_ONLY.includes(c.split('=')[0])).sort();
ok(native.length >= 2, `constants.sh: ${native.join(' ')}`);
ok(web.length >= 2, `omr-worker.js: ${web.join(' ')} (+ ${TIME_ONLY.length} time-only)`);
ok(JSON.stringify(native) === JSON.stringify(web), `the native runs pass the web's constants${JSON.stringify(native) === JSON.stringify(web) ? '' : ` — only in constants.sh: ${native.filter((c) => !web.includes(c)).join(' ') || '-'}; only in the worker: ${web.filter((c) => !native.includes(c)).join(' ') || '-'}`}`);
done();
