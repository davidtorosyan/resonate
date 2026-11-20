// A small valid PDF (letter pages, staff-like lines, a big page number in Helvetica) — for the
// Play page's PDF view tests. pdfmini(n) → Buffer
// heavy: that many extra short strokes a page (a slow page to draw, for render races)
function pdfmini(n = 3, { w = 612, h = 792, heavy = 0 } = {}) {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pagesId = objs.length + 1 + 2 * n; // after the pages and their contents
  const kids = [];
  for (let i = 1; i <= n; i++) {
    let c = "0 0 0 RG 1 w\n";
    for (let s = 0; s < 4; s++) for (let l = 0; l < 5; l++) { const y = h - 200 - s * 140 - l * 8; c += `60 ${y} m ${w - 60} ${y} l S\n`; }
    c += `BT /F1 96 Tf 240 ${h - 150} Td (P${i}) Tj ET\n`;
    for (let k = 0; k < heavy; k++) { const x = 40 + ((k * 37 + i * 11) % (w - 80)), y = 40 + ((k * 53) % (h - 300)); c += `${x} ${y} m ${x + 3 + (k % 7)} ${y + 2 + (k % 5)} l S\n`; }
    const cid = add(`<< /Length ${Buffer.byteLength(c)} >>\nstream\n${c}endstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${cid} 0 R >>`));
  }
  const pid = add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${n} >>`);
  if (pid !== pagesId) throw new Error("pages id");
  const cat = add(`<< /Type /Catalog /Pages ${pid} 0 R >>`);
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
module.exports = { pdfmini };
if (require.main === module) require("fs").writeFileSync(process.argv[2] || "mini.pdf", pdfmini(Number(process.argv[3]) || 3));
