# SortSafe · Tiny Homes Directory

A comprehensive, filterable directory of **real tiny homes** — live at
**[sortsafe.com](https://sortsafe.com)**.

Browse 1,300+ actual tiny-house listings with photo thumbnails and filter by
price, square footage, length, width, weight, bedrooms, bathrooms, lofts, type,
offer (sale/rent/build-to-order) and location.

## Data

All records are aggregated from public sources — **no mock or fabricated data**.
Missing fields stay empty rather than being inferred; ambiguous values (e.g. a
"sleeps 4–8" range) are left null, never guessed.

| Source | Records | Notes |
| --- | --- | --- |
| [Tiny House Listings](https://tinyhouselistings.com) | ~1,372 | Public JSON API; price, size, dimensions, photos, location |
| Mint Tiny House Company | 25 | Builder catalog + priced inventory |
| Wind River Built | 21 | Builder catalog |
| Dragon Tiny Homes | 15 | Builder catalog + inventory |
| Tiny Mountain Houses | 14 | Builder catalog |
| Mustard Seed Tiny Homes | 11 | Builder catalog |
| Timbercraft Tiny Homes | 10 | Builder catalog |
| Rocky Mountain Tiny Houses | 8 | Finished homes (DIY plans excluded) |
| New Frontier Design | 7 | Builder catalog |

**~1,483 homes across 9 sources / 8 named builders.**

Pipeline:

```bash
node scripts/harvest-thl.mjs    # -> data/raw/sources/thl.json
# builder sources are scraped into data/raw/sources/<builder>.json
node scripts/consolidate.mjs    # merges all sources -> public/data/tiny-homes.json
```

`consolidate.mjs` normalizes every record to the canonical schema (missing →
null), re-applies plausibility clamps, dedupes by id, and keeps only records
with a title, URL, and hotlinkable thumbnail.

## Develop

```bash
npm install
npm run dev       # vite dev server
npm run build     # tsc --noEmit && vite build  ->  dist/
npm run preview   # serve the production build
```

Stack: Vite + TypeScript (no framework), hand-rolled dark CSS, static SPA. The
canonical record shape lives in [`src/types.ts`](src/types.ts).

## Deploy

Pushed to `main` → built and published to GitHub Pages by
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). The custom apex
domain is set via [`public/CNAME`](public/CNAME).
