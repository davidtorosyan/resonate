// Sign-in (Supabase Auth: email + password). Optional — every page works signed out; an
// account will unlock cloud sync and the AI coach connection (docs/ROADMAP.md §5–7).
//
// The library (vendor/, ~58 KB gzipped) is only loaded by pages that need it (the account
// page); headers read who's signed in straight from the saved session (savedUser).
// Project: Supabase "resonate" (org Jimbo84). The publishable key is meant for the browser —
// what a signed-in user may do is decided by row-level security on the server.

export const SUPABASE_URL = "https://ltyadhjhnfxdlgsmrcds.supabase.co";
export const SUPABASE_KEY = "sb_publishable_8FEg0aiW9Ir-RrrND8kfQw_IBirLBai";
export const STORAGE_KEY = "resonate.auth"; // localStorage: the session supabase-js keeps

let client = null;
export async function supabase() {
  if (!client) {
    const { createClient } = await import("./vendor/supabase-2.118.0.js?v=70");
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        storageKey: STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        // Email links (confirm, reset password) land on the account page with the session in
        // the URL fragment. Implicit flow, not PKCE: a link opened in another browser than the
        // one that asked (Mail → Safari, while the Home Screen app has its own storage) still
        // works — PKCE would need the code verifier from the asking browser.
        detectSessionInUrl: true,
        flowType: "implicit",
      },
    });
  }
  return client;
}

// Who's signed in according to the saved session, without loading the library. (Its access
// token may have expired — the library refreshes it when a page loads it.)
export function savedUser() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    const email = s?.user?.email;
    return email ? { email, id: s.user.id } : null;
  } catch {
    return null;
  }
}

// Where email links come back to: the account page next to this one.
export const accountUrl = () => new URL("account.html", location.href.split(/[?#]/)[0]).href;
