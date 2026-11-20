// Static server (Range) + POST /collect/<name> appends the body to <outdir>/<name>.txt.
// usage: node collect-serve.mjs <root> <port> <outdir>
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const [root, port, outdir] = [path.resolve(process.argv[2]), Number(process.argv[3]), path.resolve(process.argv[4])];
fs.mkdirSync(outdir, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".jar": "application/java-archive", ".css": "text/css", ".png": "image/png", ".mp3": "audio/mpeg", ".xml": "application/xml", ".gz": "application/gzip", ".pdf": "application/pdf" };
http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (req.method === "POST" && p.startsWith("/collect/")) {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      fs.writeFileSync(path.join(outdir, p.slice(9).replace(/[^\w.-]/g, "_") + ".txt"), body); res.writeHead(204); res.end(); });
    return;
  }
  let f = path.join(root, p);
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end("not found"); }
  const size = fs.statSync(f).size;
  const headers = { "Content-Type": types[path.extname(f)] || "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    let start = range[1] === "" ? size - Number(range[2]) : Number(range[1]);
    let end = range[1] !== "" && range[2] !== "" ? Number(range[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    return req.method === "HEAD" ? res.end() : fs.createReadStream(f, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, "Content-Length": size });
  req.method === "HEAD" ? res.end() : fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log(`serving ${root} on ${port}, collecting into ${outdir}`));
