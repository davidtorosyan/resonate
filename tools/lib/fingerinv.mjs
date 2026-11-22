// The fingering's invariants (docs/FINGERING.md §8): on every case of tools/fingercases.mjs and every
// song tools/fingersurvey.mjs reads. invariants(items, res, hand) → the list of what's wrong ([] = none);
// res = fingerNotes(items, { hand, debug: true }).
import { SPANS } from "../../public/finger.js";

// ---- the invariants (§8 fingersurvey's, on every case and hand size) ----------------------------------
// no hand's fingered sounding keys span past its practical 1–5 limit (but an arpeggiated chord), fingers
// rising with pitch at every onset, a held key keeps its finger, no finger on two keys, every struck
// note fingered or flagged w / g, a tie's continuation = its start, `m` only off a staff hand.
export function invariants(items, res, hand) {
  const bad = [];
  const { A, r, l } = res.debug;
  const prac = SPANS[hand[0]][15][5];
  for (const [side, R] of [["r", r], ["l", l]]) {
    const sg = side === "l" ? -1 : 1;
    for (const st of R.path) {
      const xs = st.k.map((k) => sg * A.keys[k].x);
      for (let i = 1; i < xs.length; i++) {
        if (!(xs[i] > xs[i - 1])) bad.push(`${side} onset ${st.q}: keys not rising`);
        if (!(st.f[i] > st.f[i - 1])) bad.push(`${side} onset ${st.q}: fingers ${st.f} not rising`);
      }
      const arp = A.slices[st.s].keys.some((k) => A.keys[k].arp && A.hand[k] === (side === "l" ? 1 : 0));
      if (!arp && xs.length > 1 && xs[xs.length - 1] - xs[0] > prac) bad.push(`${side} onset ${st.q}: spans ${xs[xs.length - 1] - xs[0]} > ${prac}`);
      if (st.k.length > 5) bad.push(`${side} onset ${st.q}: ${st.k.length} keys`);
      st.k.forEach((k, i) => { if (R.f[k] !== st.f[i]) bad.push(`${side} onset ${st.q}: key ${A.keys[k].midi} finger ${st.f[i]}, struck with ${R.f[k]}`); });
    }
  }
  for (const it of items) {
    const n = res.notes.get(it.id);
    if (!n) { bad.push(`${it.id}: no entry`); continue; }
    if (n.h !== "r" && n.h !== "l") bad.push(`${it.id}: hand ${n.h}`);
    if (!(Number.isInteger(n.f) && n.f >= 0 && n.f <= 5)) bad.push(`${it.id}: finger ${n.f}`);
    if (n.f === 0 && !/[wg]/.test(n.x)) bad.push(`${it.id}: no finger, not flagged (${n.x})`);
    if (n.f !== 0 && /[wg]/.test(n.x)) bad.push(`${it.id}: fingered and flagged ${n.x}`);
    if (/m/.test(n.x) && (!it.hand || it.hand === n.h)) bad.push(`${it.id}: m on its own staff's hand`);
    if (!/m/.test(n.x) && it.hand && it.hand !== n.h && !it.grace) {
      // (a unison's twin: its key is played by the other staff's hand — not a move)
      const twin = items.some((o) => o !== it && o.midi === it.midi && Math.abs(o.q - it.q) < 1e-4 && o.hand === n.h);
      if (!twin && !it.tied) bad.push(`${it.id}: on the ${n.h} hand, staff ${it.hand}, no m`);
    }
    if (n.p < -1 || (n.p >= 0 && !res.frames[n.h][n.p])) bad.push(`${it.id}: frame ${n.p}`);
  }
  // a tie's continuation: its start's hand and finger
  for (const it of items) {
    if (!it.tied) continue;
    const n = res.notes.get(it.id);
    if (!/t/.test(n.x)) continue;
    const start = items.filter((o) => o.midi === it.midi && !o.tied && o.q < it.q && o.t + o.d > it.t - 1e-3).sort((a, b) => b.q - a.q)[0];
    const s = start && res.notes.get(start.id);
    if (!s || s.h !== n.h || s.f !== n.f) bad.push(`${it.id}: tie continuation ${n.h}${n.f}, start ${s ? s.h + s.f : "none"}`);
  }
  // frames: five keys, rising on the hand
  for (const side of ["r", "l"]) for (const fr of res.frames[side]) {
    const k = fr.keys;
    if (k.length !== 5 || k.some((m) => !Number.isInteger(m))) bad.push(`${side} frame at ${fr.q0}: keys ${k}`);
    for (let i = 1; i < 5; i++) if (side === "r" ? k[i] < k[i - 1] : k[i] > k[i - 1]) bad.push(`${side} frame at ${fr.q0}: ${k} not in finger order`);
  }
  return bad;
}

