/** Canonical tiny-home record. Every scraper maps its source onto this shape.
 *  Per data-integrity rules: unknown fields stay `null` — never fabricated. */
export interface TinyHome {
  /** Stable unique id: `${source}-${sourceId}` */
  id: string;
  title: string;
  manufacturer: string | null;
  /** Asking / MSRP price in USD */
  price: number | null;
  /** Interior square footage */
  sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  /** Sleeping capacity (rarely published) */
  sleeps: number | null;
  /** Number of sleeping lofts */
  lofts: number | null;
  lengthFt: number | null;
  widthFt: number | null;
  weightLbs: number | null;
  /** Normalized category: see TINY_HOME_TYPES */
  type: TinyHomeType | null;
  year: number | null;
  city: string | null;
  /** Two-letter US state code, or full region name */
  state: string | null;
  description: string | null;
  /** Primary thumbnail (hotlinkable absolute URL) */
  imageUrl: string | null;
  /** Additional gallery images */
  images: string[];
  /** Canonical listing/spec URL */
  sourceUrl: string;
  /** Human-readable source name */
  source: string;
  /** purchase | rent | model_purchase | null */
  purchaseType: string | null;
  /** ISO timestamp the listing was created (for "recently listed" sort) */
  listedAt: string | null;
}

export const TINY_HOME_TYPES = [
  "Tiny House on Wheels",
  "Foundation / Modular",
  "Container",
  "Park Model",
  "Van / Skoolie",
  "Cabin / A-Frame",
  "Yurt / Dome",
  "ADU",
  "Other",
] as const;

export type TinyHomeType = (typeof TINY_HOME_TYPES)[number];
