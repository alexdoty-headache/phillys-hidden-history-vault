# Philly's Hidden History Vault

A walking-tour business **and** an open historical research project on Civil War Philadelphia, sharing one domain and one brand.

- **Tours** — the commercial side: booking, marketing, and tour content. Currently at `/`, `/about`, `/book`, `/dispatches`.
- **The Vault** — the research side: a public, browsable, source-cited archive of primary research on Philadelphia's Civil War refreshment saloons (and, eventually, its military hospitals). Lives at `/vault`.
- **`/data`** — the actual research data in open, structured JSON, versioned alongside the code. This is the part meant to be forked, cited, or reused by other researchers — not just viewed on a website.

## Why this structure

Two audiences, one house. A tourist booking a walk and a historian checking a regimental muster date shouldn't feel like they landed on different websites — same header, same domain, same voice — but they need very different tools underneath. Static marketing pages for one, a searchable data app for the other.

## Status

This is an early scaffold, not a finished site:

- `/vault/saloons` — the most complete piece. A working prototype: browse by Timeline, Units (grouped by state), Volunteers, Anecdotes, and Images, all cross-linked, all source-cited, built from a **small hand-picked sample** of already-verified research (not the full ~1,478-row ledger yet).
- `/vault/hospitals` — placeholder only. No hospital research has been built out here yet.
- `/`, `/about`, `/book`, `/dispatches` — structural stubs carrying real copy where it existed (the homepage) and clearly marked placeholders where it didn't (About has no source copy yet; Book needs a Bokun embed snippet).

## Data methodology

Every record in `/data` traces to a primary source (ledger, letter, newspaper, or regimental history) with a citation. Where sources conflict or evidence is incomplete, that's stated explicitly rather than resolved silently — see the `status` field on each record (`Verified`, `Under active verification`, `Dead end (documented)`, `Gap identified`, `Open question`). Dead ends and open questions are kept in the dataset on purpose: a documented unresolved question is itself a research contribution, not something to hide.

## Local development

Everything here is static HTML/CSS/JS — no build step required. Open any `.html` file directly, or serve the folder locally:

```
npx serve .
```

## Deployment

Intended to deploy on Vercel, connected directly to this repo's `main` branch for automatic deploys on push.
