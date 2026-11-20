// Tiny static server with HTTP Range support (CheerpJ fetches jars by range).
// usage: node serve.mjs <root> <port>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const [root, port] = [path.resolve(process.argv[2] || "."), Number(process.argv[3] || 8098)];
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".jar": "application/java-archive", ".css": "text/css", ".png": "image/png", ".mp3": "audio/mpeg", ".xml": "application/xml", ".musicxml": "application/xml", ".gz": "application/gzip" };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
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
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(f, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, "Content-Length": size });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log(`serving ${root} on ${port}`));
