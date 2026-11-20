// An old page's address since v92 (sing.html, play.html, record.html, voice.html, assistants.html,
// pdf-import.html): the site is one page — the shell, at the root — and these addresses land there
// in the same state: ./?open=sing | score | record | voice | assistants | import (this tag's
// data-open), with the page's own parameters (pdf-import.html's ?reprocess=, ?pdf=). A classic
// script in the <head>, before the page's first <style>: it runs before anything is drawn, stops
// the page's loading (nothing after it is read: no module starts), and marks <html data-away>
// (nav.js never finishes there). The pages' markup stays: the shell fetches it and mounts parts of
// it — DOMParser runs no script, so this never runs there.
// The page stays itself for: ?page (Tools' PDF → Song, anyone who wants the old page), an email
// link's tokens or error in the hash (nav.js hands those to account.html), and an automated browser
// (navigator.webdriver: the old pages' own test suites) unless localStorage resonate.redirect = "1".
(function () {
  try {
    var el = document.currentScript;
    var open = el && el.getAttribute("data-open");
    if (!open) return;
    if (new URLSearchParams(location.search).has("page")) return;
    if (/(^|[#&])(access_token|error_code|error_description)=/.test(location.hash)) return;
    if (navigator.webdriver) {
      var r = null;
      try { r = localStorage.getItem("resonate.redirect"); } catch (e) {}
      if (r !== "1") return;
    }
    var q = location.search.replace(/^\?/, "");
    // The rest of the page isn't read, so none of its scripts start: nav.js's wait (data-away) holds
    // its importers back in Chromium, but WebKit runs a module script whose import still awaits when
    // that import was started by another script (sing.js after nav.js's own <script>). Stopped first:
    // a stop() after the replace would cancel it.
    var to = "./?open=" + open + (q ? "&" + q : "");
    try { window.stop(); } catch (e) {}
    location.replace(to);
    // (back to this page from the bfcache: on to the shell again, not a blank page)
    addEventListener("pageshow", function (e) { if (e.persisted) location.replace(to); });
    var html = document.documentElement;
    html.setAttribute("data-away", "");
    // (nothing shows on its way out — unless the shell hasn't come in 3 s: then a plain link there)
    html.style.background = "#0d0d1c";
    html.style.visibility = "hidden";
    setTimeout(function () {
      var a = document.createElement("a");
      a.href = to;
      // (a replace, as the redirect: a tap mustn't leave this page in the history under the shell)
      a.addEventListener("click", function (e) { e.preventDefault(); location.replace(to); });
      a.textContent = "Resonate ›";
      a.style.cssText = "display:block;padding:24px;color:#c48bff;font:15px/1.4 -apple-system,system-ui,sans-serif";
      (document.body || html).appendChild(a);
      html.style.visibility = "";
    }, 3000);
  } catch (e) {}
})();
