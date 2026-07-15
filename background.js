"use strict";

/* Redirect tracing via chrome.webRequest.
   Observing at the network layer gives us the full hop-by-hop chain (status code +
   Location for every hop), which a page-level fetch can never expose — fetch follows
   redirects opaquely. This also works regardless of CORS. */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "trace" && msg.url) {
    traceRedirects(msg.url).then(sendResponse).catch((e) =>
      sendResponse({ ok: false, error: String((e && e.message) || e) })
    );
    return true; // keep the message channel open for the async response
  }
  return false;
});

function traceRedirects(rawUrl) {
  let startHref;
  try { startHref = new URL(rawUrl).href; } catch (e) { return Promise.resolve({ ok: false, error: "Invalid URL" }); }

  return new Promise((resolve) => {
    const hops = [];               // { url, status, location }
    let reqId = null;              // the requestId of our chain
    let finalUrl = startHref;
    let finalStatus = null;
    let errorText = null;
    const t0 = Date.now();
    const filter = { urls: ["<all_urls>"] };

    const claim = (d) => {
      if (reqId === null && d.url === startHref) reqId = d.requestId;
      return d.requestId === reqId;
    };
    const onRedirect = (d) => { if (claim(d)) hops.push({ url: d.url, status: d.statusCode, location: d.redirectUrl }); };
    const onCompleted = (d) => { if (claim(d)) { finalUrl = d.url; finalStatus = d.statusCode; finish(); } };
    const onError = (d) => { if (claim(d)) { errorText = d.error; finish(); } };

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.webRequest.onBeforeRedirect.removeListener(onRedirect);
      chrome.webRequest.onCompleted.removeListener(onCompleted);
      chrome.webRequest.onErrorOccurred.removeListener(onError);
      clearTimeout(timer);
      resolve({
        ok: !errorText,
        startUrl: startHref,
        hops,
        finalUrl,
        finalStatus,
        redirects: hops.length,
        error: errorText,
        elapsedMs: Date.now() - t0,
      });
    };

    chrome.webRequest.onBeforeRedirect.addListener(onRedirect, filter);
    chrome.webRequest.onCompleted.addListener(onCompleted, filter);
    chrome.webRequest.onErrorOccurred.addListener(onError, filter);

    const timer = setTimeout(() => { errorText = errorText || "Timed out after 20s"; finish(); }, 20000);

    const ctrl = new AbortController();
    fetch(startHref, { method: "GET", redirect: "follow", cache: "no-store", signal: ctrl.signal })
      .catch((e) => { if (!errorText && !done) { errorText = String((e && e.message) || e); } })
      .finally(() => { setTimeout(finish, 100); }); // let webRequest events settle, then finalize
  });
}
