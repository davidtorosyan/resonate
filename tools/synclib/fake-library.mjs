// library.js for sync.js under synclib.mjs: in memory per device (W.dev), as library.js (v90) behaves —
// index entries with k / eng, replaceSong per docs/LIBRARY.md §2.
import { W } from './world.mjs';
const D = () => W.dev;
// (as library.js: text that isn't MusicXML — a v89 device's "null" — is a PDF only)
export const isMusicXml = (text) => typeof text === 'string' && /<score-(partwise|timewise)[\s>]/.test(text.slice(0, 65536));
const kindOf = (s) => (!isMusicXml(s.xml) ? 'pdf' : s.source === 'pdf' ? 'conv' : 'xml');
const entry = (s) => ({ id: s.id, title: s.title, added: s.added, ...(s.rev ? { rev: s.rev } : {}), k: kindOf(s), ...(kindOf(s) === 'conv' ? { eng: s.engine?.n || 0 } : {}) });
export const listSongs = async () => [...D().songs.values()].map(entry).sort((a, b) => b.added - a.added);
export const getSong = async (id) => (D().songs.has(id) ? structuredClone(D().songs.get(id)) : null);
export const putSong = async (s) => { D().songs.set(s.id, structuredClone(s)); };
let n = 0;
export async function replaceSong(id, xml, { pages = null, title = null, engine = null } = {}) {
  const old = D().songs.get(id);
  if (!old) return null;
  const { clean, pages: _p, engine: _e, titleAuto, conv, ...keep } = old;
  const s = { ...keep, xml, rev: `r${++n}`, ...(title ? { title } : {}), ...(engine ? { engine } : {}) };
  D().songs.set(id, s);
  return s;
}
export async function removeSong(id) { D().songs.delete(id); D().pdfs.delete(id); D().takes.delete(id); W.onRemove?.(id); } // (W.onRemove: a test's moment)
export const getPdf = async (id) => D().pdfs.get(id) || null;
export async function putPdf(id, pdf, name = '') { D().pdfs.set(id, { id, pdf, name, bytes: pdf.byteLength }); }
export const listPdfIds = async () => [...D().pdfs.keys()];
export const countVoices = async () => 0, countClips = async () => 0;
export const listTakes = async () => [];
export const getTake = async () => null, putTake = async () => {}, removeTake = async () => {};
export const persistent = async () => true;
export const dbGen = () => D().gen;
