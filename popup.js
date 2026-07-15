"use strict";

/* ============================================================
   Config
============================================================ */
// Site host used for "Continue" / "Make offer" links.
const API_BASE = "https://domainnameregistration.com";

// Public availability API.
const BULK_ENDPOINT = `${API_BASE}/availability/bulk-check`;

// status code -> meaning  (0 available, 1 taken, 2 aftermarket)
const STATUS = { 0: "avail", 1: "taken", 2: "after" };

// Always shown first, in this exact order, whatever their status:
const PRIORITY_TLDS = ["com", "org", "ai", "io", "net"];
// Additional TLDs checked so we can surface available options below the top 5:
const POPULAR_TLDS = [
  "com", "org", "ai", "io", "net", "co", "app", "dev", "xyz", "shop", "site",
  "online", "tech", "store", "info", "pro", "live", "news", "blog", "link",
  "me", "us", "biz", "club", "design", "studio", "cloud", "digital", "agency",
  "media", "world", "life", "fun", "space", "website", "host", "group", "zone",
];

// Show at most this many cards, kept even so both columns are equal length.
const MAX_RESULTS = 14;

/* ============================================================
   Helpers
============================================================ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
};
const splitDomain = (d) => {
  const i = d.indexOf(".");
  return i < 0 ? [d, ""] : [d.slice(0, i), d.slice(i)];
};
const cleanKeyword = (raw) =>
  (raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split(".")[0].replace(/[^a-z0-9-]/g, "");

const ICONS = {
  check: '<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  x: '<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>',
  dollar: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 2v20M17 6.5c0-2-2.2-3-5-3s-5 1-5 3 2.2 2.8 5 3.3 5 1.3 5 3.4-2.2 3.3-5 3.3-5-1.3-5-3.3"/></svg>',
  ext: '<svg class="ico" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-8 8M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></svg>',
  arrow: '<svg class="ico" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

// Each tool panel registers a (domain) => fill input + run lookup function here,
// so cards can drive a tab and so we can prefetch on popup-open.
const autorun = {};
function goToWhois(domain) {
  switchTab("whois");
  if (autorun.whois) autorun.whois(domain);
}

/* ============================================================
   API
============================================================ */
async function bulkCheck(domains) {
  const res = await fetch(BULK_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domains }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.statuses)) throw new Error("unexpected response");
  return {
    rows: domains.map((d, i) => ({ domain: d, status: data.statuses[i] ?? 1 })),
  };
}

// Promise caches so a prefetch on popup-open is reused when the user opens the tab.
const rdapCache = new Map();
const dohCache = new Map();

function rdap(domain) {
  if (rdapCache.has(domain)) return rdapCache.get(domain);
  const p = (async () => {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { Accept: "application/rdap+json" },
    });
    if (res.status === 404) throw new Error("Not registered (or unsupported TLD).");
    if (!res.ok) throw new Error(`RDAP ${res.status}`);
    return res.json();
  })();
  rdapCache.set(domain, p);
  return p;
}

function doh(name, type) {
  const key = `${name}|${type}`;
  if (dohCache.has(key)) return dohCache.get(key);
  const p = (async () => {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`);
    if (!res.ok) throw new Error(`DNS ${res.status}`);
    return res.json();
  })();
  dohCache.set(key, p);
  return p;
}

function rdapEvent(data, action) {
  const e = (data.events || []).find((x) => x.eventAction === action);
  return e ? e.eventDate : null;
}
function rdapRegistrar(data) {
  for (const ent of data.entities || []) {
    if ((ent.roles || []).includes("registrar")) {
      const vc = ent.vcardArray && ent.vcardArray[1];
      if (vc) {
        const fn = vc.find((f) => f[0] === "fn");
        if (fn) return fn[3];
      }
    }
  }
  return null;
}
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

/* ============================================================
   Domain Search panel
============================================================ */
const elResults = $("#results");
const elSummary = $("#summary");
const elQ = $("#q");

function buildDomainList(keyword) {
  const rest = POPULAR_TLDS.filter((t) => !PRIORITY_TLDS.includes(t));
  return [...PRIORITY_TLDS, ...rest].map((t) => `${keyword}.${t}`);
}

const tldOf = (domain) => domain.slice(domain.indexOf(".") + 1);

function badge(kind) {
  if (kind === "avail") return el("span", { class: "badge avail", html: `${ICONS.check}Available` });
  if (kind === "after") return el("span", { class: "badge after", html: `${ICONS.dollar}Aftermarket` });
  return el("span", { class: "badge taken", html: `${ICONS.x}Taken` });
}

function resultCard({ domain, status }) {
  const kind = STATUS[status] || "taken";
  const [root, tld] = splitDomain(domain);
  const left = el("div", { class: "card-left" },
    badge(kind),
    el("span", { class: "domain", html: `<span class="root">${root}</span><span class="tld">${tld}</span>` })
  );
  let action;
  if (kind === "avail") {
    action = el("a", { class: "btn primary", href: `${API_BASE}/search?q=${encodeURIComponent(root)}`, target: "_blank", rel: "noopener", html: `Continue ${ICONS.ext}` });
  } else if (kind === "after") {
    action = el("a", { class: "btn", href: `${API_BASE}/search?q=${encodeURIComponent(root)}`, target: "_blank", rel: "noopener", html: `${ICONS.dollar}Make offer` });
  } else {
    action = el("button", { class: "btn", onclick: () => goToWhois(domain), html: `Check WHOIS ${ICONS.arrow}` });
  }
  return el("div", { class: `card ${kind}` }, left, action);
}

function renderSummary(rows, metaText) {
  elSummary.innerHTML = "";
  const counts = { avail: 0, taken: 0, after: 0 };
  rows.forEach((r) => { counts[STATUS[r.status] || "taken"]++; });
  const mk = (cls, label, n) => el("span", { class: `chip ${cls}` }, el("span", { class: "dot" }), `${n} ${label}`);
  elSummary.append(
    mk("avail", "available", counts.avail),
    mk("taken", "taken", counts.taken),
  );
  if (counts.after) elSummary.append(mk("after", "aftermarket", counts.after));
  if (metaText) elSummary.append(el("span", { class: "meta" }, metaText));
}

async function runSearch() {
  const keyword = cleanKeyword(elQ.value);
  if (!keyword) {
    elResults.innerHTML = '<div class="empty">Enter a domain name to check.</div>';
    elSummary.innerHTML = "";
    return;
  }
  const domains = buildDomainList(keyword);
  elSummary.innerHTML = "";
  elResults.innerHTML = "";
  for (let i = 0; i < Math.min(domains.length, 10); i++) elResults.append(el("div", { class: "skeleton" }));
  elSummary.append(el("span", { class: "meta" }, "Checking…"));

  const t0 = performance.now();
  try {
    const { rows } = await bulkCheck(domains);
    const ms = Math.round(performance.now() - t0);

    // Top 5: the priority TLDs, always shown in their fixed order.
    const top = PRIORITY_TLDS
      .map((t) => rows.find((r) => tldOf(r.domain) === t))
      .filter(Boolean);
    // Below: every other extension that is available (or aftermarket).
    const availFirst = { 0: 0, 2: 1 };
    const moreAvailable = rows
      .filter((r) => !PRIORITY_TLDS.includes(tldOf(r.domain)) && (r.status === 0 || r.status === 2))
      .sort((a, b) => (availFirst[a.status] ?? 9) - (availFirst[b.status] ?? 9));

    // Cap the list and keep it even so the two columns are the same length (7 each).
    let display = [...top, ...moreAvailable].slice(0, MAX_RESULTS);
    if (display.length % 2 !== 0) display = display.slice(0, -1);
    elResults.innerHTML = "";
    display.forEach((r) => elResults.append(resultCard(r)));
    renderSummary(display, `${domains.length} extensions • ${ms} ms`);
  } catch (err) {
    elSummary.innerHTML = "";
    elResults.innerHTML = "";
    elResults.append(el("div", { class: "error" }, `Couldn't reach the public availability API. (${err.message})`));
  }
}

/* ============================================================
   Tool panels (Age / Expiration / DNS / WHOIS / Redirect)
============================================================ */
function toolInput(id, placeholder) {
  const input = el("input", { type: "text", id, autocomplete: "off", spellcheck: "false", placeholder });
  const box = el("div", { class: "searchbox glass" });
  box.innerHTML = '<svg class="ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>';
  const go = el("button", { class: "go" }, "Check");
  box.append(input, go);
  const result = el("div", { class: "tool-result", id: `${id}-result` });
  return { box, input, result, go };
}

function buildToolPanels() {
  /* ---- Domain Age ---- */
  panelAge();
  panelExpiration();
  panelDNS();
  panelWhois();
  panelRedirect();
}

function spinnerInto(node, label) {
  node.innerHTML = "";
  node.append(el("div", { class: "note", html: `<span class="spinner"></span>${label}` }));
}
function errorInto(node, msg) {
  node.innerHTML = "";
  node.append(el("div", { class: "error" }, msg));
}

function panelAge() {
  const p = $("#panel-age");
  const t = toolInput("age-q", "Enter a domain, e.g. google.com");
  p.append(t.box, t.result);
  const run = async () => {
    const dom = cleanDomain(t.input.value);
    if (!dom) return;
    spinnerInto(t.result, "Looking up registration date…");
    try {
      const data = await rdap(dom);
      const reg = rdapEvent(data, "registration");
      if (!reg) { errorInto(t.result, "No registration date available for this domain."); return; }
      const days = Math.floor((Date.now() - new Date(reg)) / 86400000);
      const years = (days / 365.25);
      t.result.innerHTML = "";
      t.result.append(
        el("div", { class: "bignum" },
          el("div", { class: "n" }, `${years.toFixed(1)} yrs`),
          el("div", { class: "l" }, `${days.toLocaleString()} days old`)
        ),
        kv("Domain", dom),
        kv("Registered", fmtDate(reg)),
        kv("Last changed", fmtDate(rdapEvent(data, "last changed"))),
      );
    } catch (e) { errorInto(t.result, e.message); }
  };
  t.go.addEventListener("click", run);
  t.input.addEventListener("keydown", (e) => e.key === "Enter" && run());
  autorun.age = (d) => { t.input.value = d; run(); };
}

function panelExpiration() {
  const p = $("#panel-expiration");
  const t = toolInput("exp-q", "Enter a domain, e.g. google.com");
  p.append(t.box, t.result);
  const run = async () => {
    const dom = cleanDomain(t.input.value);
    if (!dom) return;
    spinnerInto(t.result, "Looking up expiration date…");
    try {
      const data = await rdap(dom);
      const exp = rdapEvent(data, "expiration");
      if (!exp) { errorInto(t.result, "No expiration date available for this domain."); return; }
      const days = Math.ceil((new Date(exp) - Date.now()) / 86400000);
      t.result.innerHTML = "";
      t.result.append(
        el("div", { class: "bignum" },
          el("div", { class: "n" }, days > 0 ? `${days.toLocaleString()}` : "Expired"),
          el("div", { class: "l" }, days > 0 ? "days until expiration" : "this domain has expired")
        ),
        kv("Domain", dom),
        kv("Expires", fmtDate(exp)),
        kv("Registered", fmtDate(rdapEvent(data, "registration"))),
      );
    } catch (e) { errorInto(t.result, e.message); }
  };
  t.go.addEventListener("click", run);
  t.input.addEventListener("keydown", (e) => e.key === "Enter" && run());
  autorun.expiration = (d) => { t.input.value = d; run(); };
}

const DNS_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS"];

function panelDNS() {
  const p = $("#panel-dns");
  const t = toolInput("dns-q", "Enter a domain, e.g. google.com");
  p.append(t.box, t.result);
  const run = async () => {
    const dom = cleanDomain(t.input.value);
    if (!dom) return;
    spinnerInto(t.result, "Resolving DNS records…");
    try {
      const sets = await Promise.all(
        DNS_TYPES.map((tp) => doh(dom, tp).then((d) => ({ tp, answers: d.Answer || [] })).catch(() => ({ tp, answers: [] })))
      );
      t.result.innerHTML = "";
      let any = false;
      sets.forEach(({ tp, answers }) => {
        if (!answers.length) return;
        any = true;
        answers.forEach((a) => {
          t.result.append(el("div", { class: "dns-row" },
            el("span", { class: "type" }, tp),
            el("span", { class: "data" }, a.data),
            el("span", { class: "ttl" }, `TTL ${a.TTL}s`),
          ));
        });
      });
      if (!any) t.result.append(el("div", { class: "note" }, `No DNS records found for ${dom}.`));
    } catch (e) { errorInto(t.result, e.message); }
  };
  t.go.addEventListener("click", run);
  t.input.addEventListener("keydown", (e) => e.key === "Enter" && run());
  autorun.dns = (d) => { t.input.value = d; run(); };
}

function panelWhois() {
  const p = $("#panel-whois");
  const t = toolInput("whois-q", "Enter a domain, e.g. google.com");
  p.append(t.box, t.result);
  const run = async () => {
    const dom = cleanDomain(t.input.value);
    if (!dom) return;
    spinnerInto(t.result, "Fetching WHOIS / RDAP record…");
    try {
      const data = await rdap(dom);
      const ns = (data.nameservers || []).map((n) => n.ldhName).filter(Boolean);
      const status = (data.status || []).join(", ");
      t.result.innerHTML = "";
      t.result.append(
        kv("Domain", (data.ldhName || dom).toLowerCase()),
        kv("Registrar", rdapRegistrar(data) || "—"),
        kv("Registered", fmtDate(rdapEvent(data, "registration"))),
        kv("Expires", fmtDate(rdapEvent(data, "expiration"))),
        kv("Updated", fmtDate(rdapEvent(data, "last changed"))),
        kv("Name servers", ns.length ? ns.join("\n") : "—"),
        kv("Status", status || "—"),
      );
    } catch (e) { errorInto(t.result, e.message); }
  };
  t.go.addEventListener("click", run);
  t.input.addEventListener("keydown", (e) => e.key === "Enter" && run());
  // Allow result cards (Check WHOIS) and prefetch to populate and run this tab.
  autorun.whois = (d) => { t.input.value = d; run(); };
}

// Ask the background service worker to trace redirects via chrome.webRequest, which
// captures the full hop-by-hop chain. Falls back to a single fetch in the preview.
function traceRedirects(url) {
  if (window.__TEST_TRACE__) return Promise.resolve(window.__TEST_TRACE__);
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "trace", url }, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(resp);
      });
    });
  }
  // Preview fallback: limited (no per-hop chain, subject to CORS).
  return fetch(url, { method: "GET", redirect: "follow" }).then((res) => ({
    ok: true,
    startUrl: url,
    hops: res.redirected ? [{ url, status: "3xx", location: res.url }] : [],
    finalUrl: res.url || url,
    finalStatus: res.status,
    redirects: res.redirected ? 1 : 0,
    error: null,
  }));
}

function httpClass(s) {
  const n = parseInt(s, 10);
  if (n >= 200 && n < 300) return "ok";
  if (n >= 300 && n < 400) return "redir";
  if (n >= 400) return "bad";
  return "";
}

function renderTrace(node, tr) {
  node.innerHTML = "";
  if (!tr) { errorInto(node, "No response from tracer."); return; }

  // Build the ordered list of URLs visited, with the status returned at each.
  const steps = [
    ...(tr.hops || []).map((h) => ({ url: h.url, status: h.status })),
    { url: tr.finalUrl, status: tr.finalStatus },
  ].filter((s) => s.url);

  node.append(
    kv("Requested", tr.startUrl),
    kv("Final URL", tr.finalUrl || "—"),
    kv("Redirects", String(tr.redirects ?? (steps.length - 1))),
    kv("Final status", tr.finalStatus != null ? String(tr.finalStatus) : (tr.error ? "—" : "—")),
  );
  if (tr.elapsedMs != null) node.append(kv("Time", `${tr.elapsedMs} ms`));

  if (steps.length) {
    node.append(el("div", { class: "trace-title" }, "Redirect chain"));
    steps.forEach((s, i) => {
      node.append(el("div", { class: "hop" },
        el("span", { class: "hop-n" }, String(i + 1)),
        el("span", { class: `hop-status ${httpClass(s.status)}` }, s.status != null ? String(s.status) : "—"),
        el("span", { class: "hop-url" }, s.url),
      ));
    });
  }

  if (tr.error) node.append(el("div", { class: "error" }, `Network error: ${tr.error}`));
}

function panelRedirect() {
  const p = $("#panel-redirect");
  const t = toolInput("redir-q", "Enter a URL, e.g. example.com");
  p.append(t.box, t.result);
  const run = async () => {
    let url = (t.input.value || "").trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    spinnerInto(t.result, "Following redirects…");
    try {
      const tr = await traceRedirects(url);
      renderTrace(t.result, tr);
    } catch (e) {
      errorInto(t.result, `Couldn't trace redirects. (${e.message})`);
    }
  };
  t.go.addEventListener("click", run);
  t.input.addEventListener("keydown", (e) => e.key === "Enter" && run());
}

const cleanDomain = (raw) =>
  (raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].replace(/[^a-z0-9.-]/g, "");

function kv(k, v) {
  return el("div", { class: "kv" },
    el("span", { class: "k" }, k),
    el("span", { class: "v", style: "white-space:pre-line" }, v)
  );
}

/* ============================================================
   Current page detection + prefetch
============================================================ */
async function getCurrentUrl() {
  if (window.__TEST_URL__) return window.__TEST_URL__; // preview/testing override
  if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          resolve((tabs && tabs[0] && tabs[0].url) || "");
        });
      } catch (e) { resolve(""); }
    });
  }
  return "";
}

function parseTarget(url) {
  let host;
  try { host = new URL(url).hostname; } catch (e) { return null; }
  host = (host || "").replace(/^www\./, "");
  // Skip non-public hosts: chrome://, localhost, IP addresses, single-label.
  if (!host || !host.includes(".") || /^[\d.]+$/.test(host)) return null;
  const registrable = host.split(".").slice(-2).join(".");
  return { host, registrable };
}

// Prefetch Age / Expiration / WHOIS / DNS for the page the user is on, so the data
// is ready the moment they open one of those tabs. RDAP is shared via its cache.
async function prefetchCurrentPage() {
  const target = parseTarget(await getCurrentUrl());
  if (!target) return;
  autorun.age && autorun.age(target.registrable);
  autorun.expiration && autorun.expiration(target.registrable);
  autorun.whois && autorun.whois(target.registrable);
  autorun.dns && autorun.dns(target.host);
}

/* ============================================================
   Tab + mode switching
============================================================ */
function switchTab(tab) {
  $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".panel").forEach((pn) => pn.classList.toggle("hidden", pn.id !== `panel-${tab}`));
  if (tab === "search") elQ.focus();
  else { const inp = $(`#panel-${tab} input`); if (inp) inp.focus(); }
}

/* ============================================================
   Init
============================================================ */
function init() {
  buildToolPanels();

  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (b) switchTab(b.dataset.tab);
  });

  let debounce;
  elQ.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(debounce); runSearch(); } });
  elQ.addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(runSearch, 450); });

  // "/" focuses search like the live site
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
      e.preventDefault();
      switchTab("search");
      elQ.focus();
    }
  });

  elQ.focus();
  prefetchCurrentPage();
}

document.addEventListener("DOMContentLoaded", init);
