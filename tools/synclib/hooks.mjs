// Module hooks (registered by synclib.mjs): public/sync.js's imports of auth.js / space.js / library.js /
// omr/queue.js / omr/jobs.js resolve to the fakes in this folder — also for v89's sync.js (a copy from git
// history, v89-sync.mjs: a v89 tab in the same browser); everything else as usual.
const here = new URL('./', import.meta.url);
export async function resolve(spec, ctx, next) {
  const m = /\/(auth|space|library|queue|jobs)\.js\?v=\d+$/.exec(spec);
  if (m && (ctx.parentURL?.includes('/public/sync.js') || ctx.parentURL?.endsWith('/v89-sync.mjs'))) return { url: new URL(`fake-${m[1]}.mjs`, here).href, shortCircuit: true };
  return next(spec, ctx);
}
