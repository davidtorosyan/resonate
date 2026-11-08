// Assistants (v73): connect ChatGPT / Claude to the account (the MCP server's URL), see and
// remove connected assistants (Supabase Auth OAuth grants), and the account's devices — which
// one has 📡 Remote on (switched on only from that device's Sing page; off from here too).
import { SUPABASE_URL } from "./auth.js?v=74";
import { ready, device, renameDevice } from "./assist.js?v=74";

const $ = (id) => document.getElementById(id);
const msg = $("msg");
const say = (text = "", kind = "") => { msg.textContent = text; msg.dataset.kind = kind; };
const MCP_URL = `${SUPABASE_URL}/functions/v1/mcp`;

function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  return s < 90 ? "now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
}
function item(name, sub, button) {
  const el = document.createElement("div");
  el.className = "item";
  const what = document.createElement("div");
  what.className = "what";
  const n = document.createElement("span");
  n.className = "name";
  if (name instanceof Node) n.append(name); else n.textContent = name;
  const s = document.createElement("span");
  s.className = "sub";
  s.textContent = sub;
  what.append(n, s);
  el.append(what);
  if (button) el.append(button);
  return el;
}
const btn = (text, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "small"; b.textContent = text; b.addEventListener("click", fn); return b; };

$("url").value = MCP_URL;
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(MCP_URL); say("Copied.", "ok"); }
  catch { $("url").select(); say("Select and copy it.", ""); }
});

let c = null;

// Standing instructions: sent to the assistant with every status and command (MCP server).
const DEFAULT_STANDING = "When you start a take, say only \"Go\" (or nothing) and stay quiet until it ends; follow along with get_live_lines without speaking. For a short performance, start it with to_line rather than stopping it yourself. After a take, give your feedback in two or three short sentences: what went well, then one thing to try.";
async function showRules() {
  const { data } = await c.sb.from("assistant_settings").select("instructions,start_delay_s,review_after_remote").maybeSingle();
  $("standing").value = data?.instructions || DEFAULT_STANDING;
  $("delay").value = String(data?.start_delay_s ?? 4);
  if (!$("delay").value) $("delay").value = "4";
  $("review-after").checked = !!data?.review_after_remote;
}
$("save-rules").addEventListener("click", async (e) => {
  e.target.disabled = true;
  const instructions = $("standing").value.trim();
  const { error } = await c.sb.from("assistant_settings").upsert({ instructions: instructions === DEFAULT_STANDING ? "" : instructions, start_delay_s: Number($("delay").value) || 0, review_after_remote: $("review-after").checked, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  e.target.disabled = false;
  $("rules-msg").textContent = error ? "Couldn't save." : "Saved.";
  setTimeout(() => { $("rules-msg").textContent = ""; }, 2500);
});
async function showGrants() {
  const { data, error } = await c.sb.auth.oauth.listGrants();
  const box = $("grants");
  box.textContent = "";
  if (error) { box.append(Object.assign(document.createElement("div"), { className: "none", textContent: "Couldn't read them." })); return; }
  const list = Array.isArray(data) ? data : data?.grants || [];
  if (!list.length) { box.append(Object.assign(document.createElement("div"), { className: "none", textContent: "None yet." })); return; }
  for (const g of list) {
    const client = g.client || {};
    const id = client.id || client.client_id || g.client_id;
    const when = g.granted_at || g.created_at;
    box.append(item(client.name || client.client_name || "Assistant", when ? `since ${new Date(when).toLocaleDateString()}` : "", btn("Remove", async (e) => {
      e.target.disabled = true;
      const { error: err } = await c.sb.auth.oauth.revokeGrant({ clientId: id });
      if (err) { say(err.message || "Couldn't remove it.", "error"); e.target.disabled = false; return; }
      say("Removed.", "ok");
      showGrants();
    })));
  }
}

async function showDevices() {
  const { data, error } = await c.sb.from("devices").select("id,name,remote,seen_at,state").order("seen_at", { ascending: false });
  const box = $("devices");
  box.textContent = "";
  if (error || !data?.length) { box.append(Object.assign(document.createElement("div"), { className: "none", textContent: error ? "Couldn't read them." : "Open the Sing page on a device to add it." })); return; }
  const me = device().id;
  for (const d of data) {
    const name = document.createElement("span");
    name.textContent = d.name || "Device";
    if (d.remote) name.append(Object.assign(document.createElement("span"), { className: "on", textContent: "  📡 Remote on" }));
    const sub = `${d.id === me ? "this device · " : ""}${ago(d.seen_at)}${d.state?.song?.title ? ` · ${d.state.song.title}` : ""}`;
    const button = d.remote ? btn("Turn off", async (e) => {
      e.target.disabled = true;
      const { error: err } = await c.sb.from("devices").update({ remote: false }).eq("id", d.id);
      if (err) say(err.message, "error");
      showDevices();
    }) : d.id === me ? btn("Rename", async () => {
      const n = prompt("Name this device:", d.name || "");
      if (n === null) return;
      const nd = renameDevice(n);
      await c.sb.from("devices").update({ name: nd.name }).eq("id", d.id);
      showDevices();
    }) : null;
    box.append(item(name, sub, button));
  }
}

c = await ready();
if (!c) {
  $("v-off").hidden = false;
  $("off-text").innerHTML = 'Sign in (with the cloud on) to connect an assistant — <a href="account.html" style="color:#c48bff">Account</a>.';
} else {
  $("v-connect").hidden = $("v-rules").hidden = $("v-grants").hidden = $("v-devices").hidden = false;
  showRules();
  showGrants();
  showDevices();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { showGrants(); showDevices(); } });
}
window.resonateDebug = () => ({ ready: !!c, url: MCP_URL, grants: $("grants").textContent, devices: $("devices").textContent });
