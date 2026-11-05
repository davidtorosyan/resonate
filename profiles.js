// Voice profiles: a name, a volume calibration and a measured vocal range, in
// localStorage. The Voice page (voice.html) edits them, the Tuner (app.js, a classic
// script that reads the same key directly) uses the active one's volume calibration,
// and Sing fits songs to the active one's range.
//
//   { active: id | null,
//     list: [{ id, name,
//              vol:   { floor, ceiling } | null,              // dB, as the Tuner measures
//              range: { low, high,                            // MIDI: lowest / highest note held
//                       comfortLow, comfortHigh,              // MIDI: where a song should sit
//                       at } | null }] }                      // when it was measured (ms)

const KEY = "resonate.profiles";
const LEGACY_VOL = "resonate.volCal"; // the Tuner's volume calibration before profiles

export function loadProfiles() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY));
    if (p && Array.isArray(p.list)) return { active: p.list.some((x) => x.id === p.active) ? p.active : p.list[0]?.id ?? null, list: p.list };
  } catch {}
  return { active: null, list: [] };
}

export function saveProfiles(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
}

export function activeProfile() {
  const p = loadProfiles();
  return p.list.find((x) => x.id === p.active) || null;
}

// A new profile, made active. The first one inherits the Tuner's existing volume
// calibration so nothing measured before is lost.
export function createProfile(name) {
  const p = loadProfiles();
  let vol = null;
  if (!p.list.length) {
    try {
      const v = JSON.parse(localStorage.getItem(LEGACY_VOL));
      if (typeof v?.floor === "number" && typeof v?.ceiling === "number") vol = { floor: v.floor, ceiling: v.ceiling };
    } catch {}
  }
  const prof = { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim() || "Me", vol, range: null };
  p.list.push(prof);
  p.active = prof.id;
  saveProfiles(p);
  return prof;
}

export function updateProfile(id, changes) {
  const p = loadProfiles();
  const prof = p.list.find((x) => x.id === id);
  if (!prof) return null;
  Object.assign(prof, changes);
  saveProfiles(p);
  return prof;
}

export function deleteProfile(id) {
  const p = loadProfiles();
  p.list = p.list.filter((x) => x.id !== id);
  if (p.active === id) p.active = p.list[0]?.id ?? null;
  saveProfiles(p);
}

export function setActiveProfile(id) {
  const p = loadProfiles();
  if (p.list.some((x) => x.id === id)) p.active = id;
  saveProfiles(p);
}
