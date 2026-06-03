/**
 * Merge every source file in data/raw/sources/*.json into the final dataset
 * public/data/tiny-homes.json.
 *
 * Each source file is an array of (partial) TinyHome records. This script
 * normalizes every record to the full schema (missing fields -> null, never
 * invented), defensively re-applies plausibility clamps, drops records without
 * a thumbnail/title/url, dedupes by id, and writes a minified array.
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = resolve(ROOT, "data/raw/sources");
const OUT = resolve(ROOT, "public/data/tiny-homes.json");

const TYPES = new Set([
  "Tiny House on Wheels",
  "Foundation / Modular",
  "Container",
  "Park Model",
  "Van / Skoolie",
  "Cabin / A-Frame",
  "Yurt / Dome",
  "ADU",
  "Other",
]);

// Plausibility ceilings — values above these are source errors -> null.
const MAX = { sqft: 5000, bedrooms: 12, bathrooms: 12, sleeps: 30, lofts: 8, lengthFt: 120, widthFt: 40, weightLbs: 120000, price: 5_000_000 };

function num(v, ceiling) {
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.]/g, "")) : v;
  if (!Number.isFinite(n) || n <= 0) return null;
  return ceiling != null && n > ceiling ? null : n;
}
function str(v) {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t || null;
}
function trimDesc(v) {
  const t = str(v);
  return t && t.length > 600 ? t.slice(0, 597) + "…" : t;
}

function normalize(r) {
  const title = str(r.title);
  const sourceUrl = str(r.sourceUrl);
  const imageUrl = str(r.imageUrl);
  if (!title || !sourceUrl || !imageUrl) return null; // require core fields + thumbnail
  const type = TYPES.has(r.type) ? r.type : r.type ? "Other" : null;
  const images = Array.isArray(r.images) ? [...new Set(r.images.filter((x) => typeof x === "string"))].slice(0, 12) : [];
  if (imageUrl && !images.includes(imageUrl)) images.unshift(imageUrl);
  return {
    id: str(r.id) ?? sourceUrl,
    title,
    manufacturer: str(r.manufacturer),
    price: num(r.price, MAX.price),
    sqft: num(r.sqft, MAX.sqft),
    bedrooms: num(r.bedrooms, MAX.bedrooms),
    bathrooms: num(r.bathrooms, MAX.bathrooms),
    sleeps: num(r.sleeps, MAX.sleeps),
    lofts: num(r.lofts, MAX.lofts),
    lengthFt: num(r.lengthFt, MAX.lengthFt),
    widthFt: num(r.widthFt, MAX.widthFt),
    weightLbs: num(r.weightLbs, MAX.weightLbs),
    type,
    year: num(r.year, 2100),
    city: str(r.city),
    state: str(r.state),
    description: trimDesc(r.description),
    imageUrl,
    images,
    sourceUrl,
    source: str(r.source) ?? "Unknown",
    purchaseType: str(r.purchaseType),
    listedAt: str(r.listedAt),
  };
}

async function main() {
  const files = (await readdir(SRC_DIR)).filter((f) => f.endsWith(".json"));
  const byId = new Map();
  const perSource = {};
  for (const f of files) {
    let arr;
    try {
      arr = JSON.parse(await readFile(join(SRC_DIR, f), "utf8"));
    } catch (e) {
      console.warn(`  ! skip ${f}: ${e.message}`);
      continue;
    }
    if (!Array.isArray(arr)) {
      console.warn(`  ! skip ${f}: not an array`);
      continue;
    }
    let kept = 0;
    for (const raw of arr) {
      const rec = normalize(raw);
      if (!rec) continue;
      if (!byId.has(rec.id)) {
        byId.set(rec.id, rec);
        kept++;
      }
    }
    perSource[f] = `${kept}/${arr.length}`;
  }

  const homes = [...byId.values()];
  // THL listings (have listedAt) newest-first; builder catalog models follow.
  homes.sort((a, b) => {
    if (!!a.listedAt !== !!b.listedAt) return a.listedAt ? -1 : 1;
    return (b.listedAt ?? "").localeCompare(a.listedAt ?? "");
  });

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(homes));

  const builders = new Set(homes.map((h) => h.manufacturer).filter(Boolean));
  console.log("Per source (kept/total):", JSON.stringify(perSource, null, 1));
  console.log(`\n✓ ${homes.length} homes -> ${OUT}`);
  console.log(`  sources: ${files.length}  builders: ${builders.size}  priced: ${homes.filter((h) => h.price).length}  dims: ${homes.filter((h) => h.lengthFt).length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
