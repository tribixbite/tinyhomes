# SortSafe · Tiny Homes Directory

A comprehensive, filterable directory of **real tiny homes** — live at
**[sortsafe.com](https://sortsafe.com)**.

Browse 1,300+ actual tiny-house listings with photo thumbnails and filter by
price, square footage, length, width, weight, bedrooms, bathrooms, lofts, type,
offer (sale/rent/build-to-order) and location.

## Data

All records are aggregated from public sources — **no mock or fabricated data**.
Missing fields stay empty rather than being inferred.

| Source | Records | Notes |
| --- | --- | --- |
| [Tiny House Listings](https://tinyhouselistings.com) | ~1,372 | Public JSON API; price, size, dimensions, photos, location |

Re-harvest with:

```bash
node scripts/harvest-thl.mjs    # writes public/data/tiny-homes.json
```

The harvester paginates the listings index, enriches each listing with its
detail record (length/width/weight/description), normalizes `property_type` into
display categories, and keeps only listings that have a hotlinkable thumbnail.

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
