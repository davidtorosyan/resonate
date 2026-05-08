import express from "express";
import { networkInterfaces } from "os";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import selfsigned from "selfsigned";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CERT_DIR = join(__dirname, "certs");
const CERT_FILE = join(CERT_DIR, "cert.pem");
const KEY_FILE = join(CERT_DIR, "key.pem");

const HTTP_PORT = Number(process.env.HTTP_PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const HOST = "0.0.0.0";

function localIPs() {
  const out = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4") out.push({ name, address: addr.address, internal: addr.internal });
    }
  }
  return out;
}

function getOrCreateCerts() {
  if (existsSync(CERT_FILE) && existsSync(KEY_FILE)) {
    return { cert: readFileSync(CERT_FILE), key: readFileSync(KEY_FILE) };
  }
  console.log("Generating self-signed certificate (one-time)…");
  const altNames = [
    { type: 2, value: "localhost" },
    ...localIPs().map(({ address }) => ({ type: 7, ip: address })),
  ];
  const pems = selfsigned.generate(
    [{ name: "commonName", value: "resonate.local" }],
    {
      days: 825,
      keySize: 2048,
      algorithm: "sha256",
      extensions: [
        { name: "subjectAltName", altNames },
        { name: "basicConstraints", cA: false },
        { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
        { name: "extKeyUsage", serverAuth: true },
      ],
    },
  );
  if (!existsSync(CERT_DIR)) mkdirSync(CERT_DIR);
  writeFileSync(CERT_FILE, pems.cert);
  writeFileSync(KEY_FILE, pems.private);
  return { cert: pems.cert, key: pems.private };
}

const app = express();
app.use(express.static("public"));
app.get("/api/hello", (req, res) => {
  res.json({ message: "Hello from Resonate!", time: new Date().toISOString() });
});

createHttpServer(app).listen(HTTP_PORT, HOST);
const { cert, key } = getOrCreateCerts();
createHttpsServer({ cert, key }, app).listen(HTTPS_PORT, HOST);

console.log(`\nResonate ready\n`);
console.log(`  Local:    http://localhost:${HTTP_PORT}`);
console.log(`  Local:    https://localhost:${HTTPS_PORT}`);
for (const { name, address, internal } of localIPs()) {
  if (internal) continue;
  console.log(`  Network:  https://${address}:${HTTPS_PORT}  (${name})`);
}
console.log(`\n  ↑ Use an HTTPS URL on your phone — the mic only works on secure origins.\n`);
