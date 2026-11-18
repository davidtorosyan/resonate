// A page's CSS rewritten to apply only inside the shell's region for it (Sing, the Score): `body` →
// the region's root, `body[…] x` → `body[…] <scope> x`, `main` → `main` (or what it's renamed to),
// everything else → `<scope> x`; html / :root / * rules are the shell's. Media rules keep their
// conditions (the window's); keyframes and font faces stay as they are.
export function scopeCss(text, { root, scope, main = null }) {
  const tmp = document.createElement("style");
  tmp.media = "not all"; // (parsed, never applied)
  tmp.textContent = text;
  document.head.append(tmp);
  const fix = main ? (s) => s.replace(/(^|[\s>+~(])main(?=$|[\s.#:[>+~),])/g, `$1${main}`) : (s) => s;
  const one = (s) => {
    s = s.trim();
    if (s === ":root" || s === "*") return null;
    if (s === "body") return root;
    const m = s.match(/^body((?:\[[^\]]*\])*)\s+(.+)$/);
    if (m) return `body${m[1]} ${scope} ${fix(m[2])}`;
    return /^(html|body)\b/.test(s) ? null : `${scope} ${fix(s)}`;
  };
  const split = (sel) => { // top-level commas only
    const out = [];
    let depth = 0, cur = "";
    for (const c of sel) {
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      if (c === "," && !depth) { out.push(cur); cur = ""; } else cur += c;
    }
    return [...out, cur];
  };
  const walk = (rules) => {
    let out = "";
    for (const r of rules) {
      if (r instanceof CSSStyleRule) {
        const parts = split(r.selectorText);
        if (parts.some((p) => p.trim() === "html")) continue; // (html, body: the shell's)
        const sels = parts.map(one).filter(Boolean);
        if (sels.length) out += `${sels.join(", ")} { ${r.style.cssText} }\n`;
      } else if (r instanceof CSSMediaRule) out += `@media ${r.conditionText || r.media.mediaText} {\n${walk(r.cssRules)}}\n`;
      else out += `${r.cssText}\n`; // (keyframes)
    }
    return out;
  };
  const out = walk(tmp.sheet.cssRules);
  tmp.remove();
  return out;
}
