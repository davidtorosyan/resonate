// A tiny XML DOM for node suites (no DOMParser in node): enough of the DOM for the pages' DOM-on-XML
// modules (playtime.js timeline, scoretext.js) on well-formed MusicXML a suite writes itself —
// documentElement, children, nodeName, textContent, getAttribute, getElementsByTagName and
// querySelector / querySelectorAll for "tag" and "tag[attr]". Not a general parser: no namespaces, no
// DTD subsets; comments, processing instructions, the doctype and CDATA are handled.
//   import { parseXml } from "./lib/minidom.mjs";  const doc = parseXml(xmlText);

const ENT = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m);

class Text {
  constructor(t) { this.nodeType = 3; this.text = t; }
  get textContent() { return this.text; }
}
class Element {
  constructor(name, attrs) { this.nodeType = 1; this.nodeName = this.tagName = name; this.attrs = attrs; this.childNodes = []; this.children = []; this.parentNode = null; }
  getAttribute(n) { return Object.hasOwn(this.attrs, n) ? this.attrs[n] : null; }
  hasAttribute(n) { return Object.hasOwn(this.attrs, n); }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(""); }
  get firstElementChild() { return this.children[0] || null; }
  getElementsByTagName(name) { const out = []; walk(this, (e) => { if (e !== this && (name === "*" || e.nodeName === name)) out.push(e); }); return out; }
  querySelectorAll(sel) { const m = match(sel); const out = []; walk(this, (e) => { if (e !== this && m(e)) out.push(e); }); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
class Document {
  constructor(root) { this.nodeType = 9; this.documentElement = root; }
  getElementsByTagName(name) { return [this.documentElement, ...this.documentElement.getElementsByTagName(name)].filter((e) => name === "*" || e.nodeName === name); }
  querySelectorAll(sel) { const m = match(sel); return [this.documentElement, ...this.documentElement.querySelectorAll("*")].filter(m); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function walk(e, fn) { fn(e); for (const c of e.children) walk(c, fn); }
function match(sel) {
  const s = sel.trim();
  if (s === "*") return () => true;
  const m = /^([\w.-]+)(?:\[([\w.-]+)\])?$/.exec(s);
  if (!m) throw new Error(`minidom: selector not supported: ${sel}`);
  return (e) => e.nodeName === m[1] && (!m[2] || e.hasAttribute(m[2]));
}

export function parseXml(xml) {
  let i = 0, root = null;
  const stack = [];
  const top = () => stack[stack.length - 1];
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    const text = xml.slice(i, lt < 0 ? xml.length : lt);
    if (text && top()) top().childNodes.push(new Text(decode(text)));
    if (lt < 0) break;
    if (xml.startsWith("<!--", lt)) { i = xml.indexOf("-->", lt) + 3; continue; }
    if (xml.startsWith("<![CDATA[", lt)) { const e = xml.indexOf("]]>", lt); if (top()) top().childNodes.push(new Text(xml.slice(lt + 9, e))); i = e + 3; continue; }
    if (xml.startsWith("<?", lt)) { i = xml.indexOf("?>", lt) + 2; continue; }
    if (xml.startsWith("<!", lt)) { i = xml.indexOf(">", lt) + 1; continue; }
    const gt = xml.indexOf(">", lt);
    const tag = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (tag[0] === "/") {
      const name = tag.slice(1).trim(), e = stack.pop();
      if (!e || e.nodeName !== name) throw new Error(`minidom: </${name}> closes <${e?.nodeName}>`);
      continue;
    }
    const self = tag.endsWith("/");
    const body = self ? tag.slice(0, -1) : tag;
    const name = /^[^\s/>]+/.exec(body)[0];
    const attrs = {};
    for (const a of body.slice(name.length).matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[3] ?? a[4]);
    const el = new Element(name, attrs);
    if (top()) { el.parentNode = top(); top().childNodes.push(el); top().children.push(el); } else root = el;
    if (!self) stack.push(el);
  }
  if (stack.length || !root) throw new Error("minidom: unclosed elements");
  return new Document(root);
}
