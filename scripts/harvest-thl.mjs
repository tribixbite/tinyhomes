/**
 * Harvest real tiny-home listings from the Tiny House Listings public JSON API.
 *
 *   list:   GET /api/v1/listings/search?per_page=100&page=N   (title, type, beds,
 *           baths, area, city/state, price, photos, created_at)
 *   detail: GET /api/v1/listings/{id}                          (length, width,
 *           height, weight, lofts, description, full address)
 *
 * Images are hotlinkable from BunnyCDN: https://thl-images.b-cdn.net/{src}
 *
 * Output: public/data/tiny-homes.json  (array of TinyHome, see src/types.ts)
 * No values are fabricated — missing fields stay null.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const API = "https://api.tinyhouselistings.com/api/v1";
const CDN = "https://thl-images.b-cdn.net";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/data/tiny-homes.json");

const PER_PAGE = 100;
const CONCURRENCY = 6;
const RETRIES = 4;

/** property_type enum -> our normalized TinyHomeType (land is dropped, not a home). */
const TYPE_MAP = {
  tiny_house: "Tiny House on Wheels",
  tiny_house_trailer: "Tiny House on Wheels",
  tiny_house_shell: "Tiny House on Wheels",
  park_model: "Park Model",
  container_home: "Container",
  camper: "Van / Skoolie",
  converted_bus: "Van / Skoolie",
  van: "Van / Skoolie",
  rv: "Van / Skoolie",
  cabin: "Cabin / A-Frame",
  apartment: "Foundation / Modular",
  other: "Other",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, label) {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const text = await res.text();
      if (res.ok && text.trim()) return JSON.parse(text);
      throw new Error(`status ${res.status}, len ${text.length}`);
    } catch (err) {
      if (attempt === RETRIES) {
        console.warn(`  ✗ ${label}: ${err.message}`);
        return null;
      }
      await sleep(400 * attempt);
    }
  }
  return null;
}

/** Run an async mapper over items with a fixed concurrency pool. */
async function pool(items, worker, concurrency) {
  const out = new Array(items.length);
  let i = 0;
  let done = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
      if (++done % 100 === 0) console.log(`  enriched ${done}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
  return out;
}

function imgUrl(src) {
  return src ? `${CDN}/${src}` : null;
}

function toFeet(value, unit) {
  if (value == null) return null;
  return unit === "meters" ? Math.round(value * 3.28084 * 10) / 10 : value;
}

function mapRecord(base, detail) {
  const d = detail ?? {};
  const propertyType = d.property_type ?? base.property_type;
  if (propertyType === "land") return null; // not a dwelling
  const unit = d.measurement_unit ?? "feet";

  const attachments = (d.attachments ?? base.attachments ?? [])
    .filter((a) => a.media_type !== "video" && a.src)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const images = attachments.map((a) => imgUrl(a.src)).filter(Boolean);
  const primary = imgUrl(base.photo_public_id) ?? images[0] ?? null;

  const addr = d.address ?? {};
  const cents = (d.default_price ?? base.default_price)?.amount_cents;

  return {
    id: `thl-${base.id}`,
    title: (base.title ?? d.title ?? "Tiny Home").trim(),
    manufacturer: null,
    price: cents != null ? Math.round(cents / 100) : null,
    sqft: numOrNull(base.area ?? d.area),
    bedrooms: numOrNull(base.bedrooms ?? d.bedrooms),
    bathrooms: numOrNull(base.bathrooms ?? d.bathrooms),
    sleeps: null,
    lofts: numOrNull(d.lofts ?? base.lofts),
    lengthFt: toFeet(numOrNull(d.length), unit),
    widthFt: toFeet(numOrNull(d.width), unit),
    weightLbs: unit === "feet" ? numOrNull(d.weight) : null,
    type: TYPE_MAP[propertyType] ?? "Other",
    year: null,
    city: addr.city ?? base.city ?? null,
    state: normState(addr.state ?? base.state?.code ?? null),
    description: trimDesc(d.description),
    imageUrl: primary,
    images: images.slice(0, 12),
    sourceUrl: `https://tinyhouselistings.com/listing/${base.slug}`,
    source: "Tiny House Listings",
    purchaseType: base.purchase_type ?? d.purchase_type ?? null,
    listedAt: base.created_at ?? d.listed_at ?? null,
  };
}

/** Cards never show the full description; it only feeds search. Cap length to
 *  keep the payload lean (full text can run 10k+ chars). */
function trimDesc(d) {
  if (typeof d !== "string") return null;
  const t = d.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > 600 ? t.slice(0, 597) + "…" : t;
}

function numOrNull(v) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normState(s) {
  return s ? String(s).trim() : null;
}

async function main() {
  console.log("Fetching listing index…");
  const first = await getJson(`${API}/listings/search?per_page=${PER_PAGE}&page=1`, "page 1");
  if (!first) throw new Error("index fetch failed");
  const total = first.meta?.pagination?.record_count ?? 0;
  const pages = Math.ceil(total / PER_PAGE);
  console.log(`  ${total} listings across ${pages} pages`);

  let base = [...(first.listings ?? [])];
  for (let p = 2; p <= pages; p++) {
    const j = await getJson(`${API}/listings/search?per_page=${PER_PAGE}&page=${p}`, `page ${p}`);
    if (j?.listings) base.push(...j.listings);
    await sleep(120);
  }
  // dedupe by id
  const byId = new Map(base.map((b) => [b.id, b]));
  base = [...byId.values()];
  console.log(`Collected ${base.length} unique base records. Enriching with detail…`);

  const records = await pool(
    base,
    async (b) => {
      await sleep(40);
      const detail = await getJson(`${API}/listings/${b.id}`, `detail ${b.id}`);
      return mapRecord(b, detail?.listing ?? detail);
    },
    CONCURRENCY,
  );

  const homes = records.filter(Boolean).filter((h) => h.imageUrl); // require a thumbnail
  homes.sort((a, b) => (b.listedAt ?? "").localeCompare(a.listedAt ?? ""));

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(homes));
  console.log(`\n✓ Wrote ${homes.length} homes (${(JSON.stringify(homes).length / 1024 / 1024).toFixed(2)} MB) -> ${OUT}`);
  const withImg = homes.filter((h) => h.imageUrl).length;
  const withDims = homes.filter((h) => h.lengthFt).length;
  const withPrice = homes.filter((h) => h.price).length;
  console.log(`  images: ${withImg}  dimensions: ${withDims}  priced: ${withPrice}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
