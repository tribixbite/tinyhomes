# Claude Code config — sortsafe tiny homes

## Purpose
Static, filterable directory of **real** tiny homes, deployed to **sortsafe.com**
via GitHub Pages (`tribixbite/sortsafe`). The torch-directory style: card grid
with photo thumbnails + comprehensive spec filters.

## Data integrity (inherited, non-negotiable)
NEVER fabricate, infer, estimate, or default data values. Missing fields stay
`null`. The canonical record shape is `src/types.ts` (`TinyHome`).

## Data source
- **Tiny House Listings** — undocumented public JSON API, no auth:
  - List: `GET https://api.tinyhouselistings.com/api/v1/listings/search?per_page=100&page=N`
    (`meta.pagination.record_count` / `page_count`; ~1,400 active listings).
  - Detail: `GET https://api.tinyhouselistings.com/api/v1/listings/{id}` adds
    `length/width/height/weight/lofts/description/address`.
  - Images hotlink from BunnyCDN: `https://thl-images.b-cdn.net/{attachment.src}`
    (bare filename only — no path prefix or transform segment, else 403).
  - Price: `default_price.amount_cents / 100`. `measurement_unit` is `feet`|`meters`.
  - Quirk: API intermittently returns empty bodies on rapid requests — the
    harvester retries with backoff and runs a bounded concurrency pool.
- `land` property_type is dropped (not a dwelling). Descriptions capped at 600 chars
  (they only feed search; cards don't show them). Physically-impossible source
  values (unit-mix-up errors like an 857,949 ft² home) and non-comparable monthly
  rent prices are nulled in the harvester — cleaning, not fabrication.

## Multi-source pipeline
- Every source writes an array of (partial) `TinyHome` to `data/raw/sources/<name>.json`
  (gitignored). `scripts/harvest-thl.mjs` writes `thl.json`; builder catalogs are
  scraped into `<builder>.json`.
- `scripts/consolidate.mjs` merges them all → `public/data/tiny-homes.json`:
  normalizes to the canonical schema (missing → null), re-applies plausibility
  clamps, parses numbers (nulling ambiguous "4–8" ranges, never concatenating),
  dedupes by `id`, requires title+sourceUrl+imageUrl. Run it after any scrape.
- Builder sources (8, ~111 models): Dragon, Mint, Wind River, Tiny Mountain,
  Mustard Seed, Timbercraft, Rocky Mountain, New Frontier. Most are WordPress
  REST (`/wp-json/wp/v2/<cpt>`) for the model list + HTML for specs; some Webflow
  (sitemap + free-text spec blobs). Builder models have `manufacturer` set (THL
  doesn't), which populates the Builder filter; their `listedAt` is null so they
  sort after THL in the default "recently listed" view.

## Stack / Termux notes
- Vite + TypeScript, no framework. `npm run build` = `tsc --noEmit && vite build`.
- Termux: `/usr/bin/env` shebangs are broken — run bins via `node ./node_modules/<pkg>/bin/...`.
  esbuild/vite build works fine natively here.
- `import.meta.env` needs `src/vite-env.d.ts` (`/// <reference types="vite/client" />`).

## Deploy
- Push to `main` → `.github/workflows/deploy.yml` builds on GitHub runners and
  publishes to Pages. Custom domain via `public/CNAME` (sortsafe.com).
- Pages was enabled with `build_type=workflow` and `cname=sortsafe.com` set via
  `gh api`. See global CLAUDE.md "GitHub Pages behind Cloudflare proxy" for the
  Cloudflare Full-SSL pre-cert root-404 gotcha.
