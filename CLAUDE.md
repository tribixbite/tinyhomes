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
- Re-harvest: `node scripts/harvest-thl.mjs` → writes `public/data/tiny-homes.json`.
  `land` property_type is dropped (not a dwelling). Descriptions capped at 600 chars
  (they only feed search; cards don't show them).

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
