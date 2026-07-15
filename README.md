<div align="center">

<img src="icons/icon128.png" width="96" height="96" alt="Fastest Domain Name Search & Domain Data Chrome Extension icon">

# Fastest Domain Name Search & Domain Data Chrome Extension

### Search, investigate, and understand any domain—without leaving your browser.

[![Chrome](https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](manifest.json)
[![Tools](https://img.shields.io/badge/Domain_Tools-6-111827?style=for-the-badge)](#six-tools-one-popup)
[![Access](https://img.shields.io/badge/Account-Not_Required-22c55e?style=for-the-badge)](#privacy-and-network-activity)
[![API](https://img.shields.io/badge/API-Domainnameregistration.com-f97316?style=for-the-badge)](https://domainnameregistration.com)

**A fast, focused domain research toolkit powered by the same public availability API as
[Domainnameregistration.com](https://domainnameregistration.com).**

[Explore the tools](#six-tools-one-popup) · [Performance](#performance) · [How it works](#how-it-works) · [Privacy](#privacy-and-network-activity)

</div>

---

## Why this extension?

Domain research usually means bouncing between a registrar, WHOIS service, DNS tool, age
checker, and redirect debugger. This extension brings that workflow into one polished
Chrome popup.

- Search **38 popular domain extensions in one request**.
- Separate available, registered, and aftermarket results at a glance.
- Inspect registration dates, expiration, registrar, nameservers, and status.
- Resolve six common DNS record types without opening a terminal.
- Trace complete redirect chains, including every intermediate hop.
- Start with the domain in your active tab—no repetitive copying and pasting.
- Use automatic light and dark themes with a compact, native-feeling interface.

No account or API key is required.

## Six tools, one popup

| Tool | What you get | Data source |
| --- | --- | --- |
| **Domain Search** | Availability across 38 popular TLDs, prioritized results, and direct next steps | [Domainnameregistration.com](https://domainnameregistration.com) |
| **Domain Age** | Registration age in years and days | [RDAP](https://rdap.org) |
| **Domain Expiration** | Expiration date and days remaining | RDAP |
| **DNS Lookup** | A, AAAA, CNAME, MX, TXT, and NS records | [Google Public DNS](https://developers.google.com/speed/public-dns/docs/doh) |
| **WHOIS Checker** | Registrar, important dates, nameservers, and domain status | RDAP |
| **Redirect Checker** | Every redirect hop, response status, final URL, and total time | Chrome `webRequest` |

### Search results designed for decisions

Every search checks the same 38 extensions, with `.com`, `.org`, `.ai`, `.io`, and `.net`
always presented first. The extension then surfaces additional available or aftermarket
options and keeps the result grid concise. Available names link directly to the full search
experience on Domainnameregistration.com; registered names can jump straight into WHOIS.

## Performance

The extension sends all 38 domain variants in **one bulk request** to the canonical public
endpoint. It does not make one availability request per TLD.

### Shared backend reference benchmarks

The companion
[Fastest Domain Name Search MCP](https://github.com/domainnameregistration/fastest-domain-name-search-mcp#speed-benchmarks)
uses the same availability API and publishes these end-to-end Streamable HTTP measurements:

| Unique domains | Internal API batches | Runs | P50 | P95 |
| ---: | ---: | ---: | ---: | ---: |
| **250** | 1 | 10 | **9.101 ms** | **15.897 ms** |
| **1,000** | 4 | 10 | **31.050 ms** | **39.784 ms** |

These measurements used unique domains, the normal retry policy, a 250-domain internal
batch size, and a cleared MCP cache before every run. All measured upstream requests
returned HTTP `200` without retries.

> [!IMPORTANT]
> These figures demonstrate the shared backend's bulk-processing performance; they are not
> a browser-extension latency guarantee. The published benchmark ran with the API
> co-located with the MCP. Extension timing also includes the user's network distance, TLS,
> browser overhead, current service load, and upstream conditions. The popup displays the
> actual elapsed time for each search.

The extension's normal 38-domain request is well below the smallest published 250-domain
benchmark workload. No smaller latency number is extrapolated from that fact.

## Smart prefetch

When the popup opens, the extension reads the active tab's public hostname and begins
prefetching its domain data while the Domain Search tab remains visible:

1. One RDAP request is shared by Domain Age, Domain Expiration, and WHOIS.
2. DNS record lookups are cached in memory for the lifetime of the popup.
3. Opening a data tab reuses the in-flight or completed request whenever possible.

The result is a faster-feeling research flow without duplicating identical network calls.
Private hosts, IP addresses, `localhost`, browser pages, and single-label hostnames are not
prefetched.

## How it works

```text
Search phrase
    │
    ├── 38 domain variants ──► Domainnameregistration.com bulk API
    │                              └── availability results
    │
Active tab hostname
    ├──► RDAP ─────────────────► age, expiration, WHOIS
    ├──► Google DNS-over-HTTPS ► DNS records
    └──► Chrome webRequest ─────► redirect chain
```

The popup performs domain availability, RDAP, and DNS requests directly. Redirect tracing
runs through the Manifest V3 background service worker so Chrome can observe each network
hop before the final response.

## Availability API

All search checks go to the production endpoint—there is no localhost fallback:

```text
POST https://domainnameregistration.com/availability/bulk-check
Content-Type: application/json
```

Example request:

```json
{
  "domains": ["example.com", "example.ai"]
}
```

The API returns aligned domain and status arrays. The shared API defines availability,
registered, inconclusive, and aftermarket states. Availability can change quickly, so
always recheck an important domain immediately before registration, bidding, or purchase.

### Responsible use

The public API is shared infrastructure. The companion MCP documents a global capacity of
**100,000 domain checks per minute across all users**. This extension batches its normal
search into a single request; please avoid aggressive automated rechecking or unnecessary
request loops.

## Privacy and network activity

The extension contains no analytics code and does not persist a lookup history. It does,
however, send the domain being researched to the service needed to answer each request:

- Domain searches go to `domainnameregistration.com`.
- Age, expiration, and WHOIS queries go to `rdap.org`.
- DNS queries go to `dns.google`.
- Redirect checks request the target URL and observe its redirect events in Chrome.
- Opening the popup may prefetch public-domain data for the active tab as described above.

Review the policies of those services before using the extension with sensitive research.

## Permissions explained

| Permission | Why it is requested |
| --- | --- |
| `activeTab` and `tabs` | Read the current tab's URL so domain data can be prefetched when the popup opens |
| `webRequest` | Observe intermediate responses for the Redirect Checker |
| `host_permissions` for HTTP/HTTPS | Reach the availability API, RDAP, DNS-over-HTTPS, and user-supplied redirect targets |

## Project structure

```text
manifest.json      Chrome Manifest V3 configuration
popup.html         Popup structure and tool panels
popup.css          Responsive glass UI, Geist font, light/dark themes
popup.js           Search, RDAP, DNS, WHOIS, rendering, and prefetch logic
background.js      Redirect tracing service worker
fonts/             Local Geist variable font
icons/             Extension icons at 16, 48, and 128 px
```

The popup is intentionally dependency-free: plain HTML, CSS, and JavaScript keep the
extension small, auditable, and easy to modify.

## Troubleshooting

### Domain search reports an API error

Confirm that `https://domainnameregistration.com` is reachable and that the production
bulk endpoint is accepting requests. The extension intentionally does not fall back to a
local development server.

### Domain data is unavailable

Some TLD registries expose incomplete RDAP fields, use unexpected event labels, or do not
provide all registration dates. Missing upstream data cannot always be reconstructed by the
extension.

### Redirect results differ from DevTools

Service workers, browser caches, authentication, extensions, and site-specific behavior can
change a redirect path. Retest in a clean tab when comparing results.

## Related project

Need domain availability inside Codex, Claude, Cursor, or another AI client? Use the
[Fastest Domain Name Search MCP](https://github.com/domainnameregistration/fastest-domain-name-search-mcp),
which connects agents to the same canonical API with HTTP and stdio transports.

---

<div align="center">

**Powered by [Domainnameregistration.com](https://domainnameregistration.com)**

Fast domain search and practical domain intelligence, one click away.

</div>
