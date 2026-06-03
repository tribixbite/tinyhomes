import "./style.css";
import type { TinyHome } from "./types.ts";
import { TINY_HOME_TYPES } from "./types.ts";

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

interface RangeFilter {
  min: number;
  max: number;
}

interface FilterState {
  search: string;
  price: RangeFilter | null;
  sqft: RangeFilter | null;
  length: RangeFilter | null;
  width: RangeFilter | null;
  weight: RangeFilter | null;
  year: RangeFilter | null;
  beds: number; // minimum, 0 = any
  baths: number;
  sleeps: number;
  lofts: number;
  types: Set<string>;
  manufacturers: Set<string>;
  states: Set<string>;
  purchaseTypes: Set<string>;
  sort: SortKey;
}

type SortKey =
  | "price-asc"
  | "price-desc"
  | "ppsf-asc"
  | "sqft-asc"
  | "sqft-desc"
  | "newest";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "newest", label: "Recently listed" },
  { key: "price-asc", label: "Price: low → high" },
  { key: "price-desc", label: "Price: high → low" },
  { key: "ppsf-asc", label: "$/ft²: low → high" },
  { key: "sqft-asc", label: "Size: small → large" },
  { key: "sqft-desc", label: "Size: large → small" },
];

/** Price per square foot, when both are known. */
function pricePerSqft(h: TinyHome): number | null {
  return h.price != null && h.sqft ? h.price / h.sqft : null;
}

/** Slider bound: percentile-capped so a handful of large outliers don't blow
 *  out the usable scale. `capped` means real values exist above `max`, so the
 *  top thumb behaves as "and up" (no upper limit). */
interface RangeBound {
  min: number;
  max: number;
  step: number;
  capped: boolean;
}
interface Bounds {
  price: RangeBound;
  sqft: RangeBound;
  length: RangeBound;
  width: RangeBound;
  weight: RangeBound;
  year: RangeBound;
}

let HOMES: TinyHome[] = [];
let BOUNDS: Bounds;
let MANUFACTURERS: string[] = [];
let STATES: string[] = [];

/** Incremental render so we never mount all ~1,400 cards at once. */
let FILTERED: TinyHome[] = [];
let rendered = 0;
const CHUNK = 60;

const state: FilterState = {
  search: "",
  price: null,
  sqft: null,
  length: null,
  width: null,
  weight: null,
  year: null,
  beds: 0,
  baths: 0,
  sleeps: 0,
  lofts: 0,
  types: new Set(),
  manufacturers: new Set(),
  states: new Set(),
  purchaseTypes: new Set(),
  sort: "newest",
};

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  const res = await fetch(`${import.meta.env.BASE_URL}data/tiny-homes.json`);
  if (!res.ok) throw new Error(`Failed to load data: ${res.status}`);
  HOMES = (await res.json()) as TinyHome[];

  BOUNDS = computeBounds(HOMES);
  MANUFACTURERS = uniqueSorted(HOMES.map((h) => h.manufacturer));
  STATES = uniqueSorted(HOMES.map((h) => h.state));

  readUrl();
  buildSortControl();
  buildFilters();
  wireGlobalControls();

  // Load more cards as the sentinel nears the viewport.
  const io = new IntersectionObserver(
    (entries) => entries.some((e) => e.isIntersecting) && appendChunk(),
    { rootMargin: "800px" },
  );
  io.observe(el("sentinel"));

  render();
}

/* ------------------------------------------------------------------ */
/* Derivation helpers                                                  */
/* ------------------------------------------------------------------ */

/** Per-field: cap the slider max at this percentile, round bounds to a tidy
 *  number, and use this thumb step. */
const RANGE_CFG: Record<RangeField, { pct: number; round: number; step: number }> = {
  price: { pct: 0.98, round: 25000, step: 1000 },
  sqft: { pct: 0.98, round: 50, step: 5 },
  length: { pct: 0.98, round: 5, step: 1 },
  width: { pct: 0.98, round: 5, step: 1 },
  weight: { pct: 0.97, round: 2500, step: 250 },
  year: { pct: 1, round: 1, step: 1 },
};

function computeBounds(homes: TinyHome[]): Bounds {
  const sel: Record<RangeField, (h: TinyHome) => number | null> = {
    price: (h) => h.price,
    sqft: (h) => h.sqft,
    length: (h) => h.lengthFt,
    width: (h) => h.widthFt,
    weight: (h) => h.weightLbs,
    year: (h) => h.year,
  };
  const out = {} as Bounds;
  for (const field of Object.keys(RANGE_CFG) as RangeField[]) {
    const cfg = RANGE_CFG[field];
    const vals = homes
      .map(sel[field])
      .filter((v): v is number => v != null && Number.isFinite(v))
      .sort((a, b) => a - b);
    if (!vals.length) {
      out[field] = { min: 0, max: 0, step: 1, capped: false };
      continue;
    }
    const at = (p: number) => vals[Math.floor(p * (vals.length - 1))];
    const realMax = vals[vals.length - 1];
    const min = Math.floor(at(0) / cfg.round) * cfg.round;
    const max = Math.max(min + cfg.round, Math.ceil(at(cfg.pct) / cfg.round) * cfg.round);
    out[field] = { min, max, step: cfg.step, capped: realMax > max };
  }
  return out;
}

function uniqueSorted(vals: (string | null)[]): string[] {
  return [...new Set(vals.filter((v): v is string => !!v))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/* ------------------------------------------------------------------ */
/* Filtering & sorting                                                 */
/* ------------------------------------------------------------------ */

function matches(h: TinyHome): boolean {
  if (state.search) {
    const q = state.search.toLowerCase();
    const hay = [h.title, h.manufacturer, h.city, h.state, h.type, h.description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (!inRange(h.price, state.price)) return false;
  if (!inRange(h.sqft, state.sqft)) return false;
  if (!inRange(h.lengthFt, state.length)) return false;
  if (!inRange(h.widthFt, state.width)) return false;
  if (!inRange(h.weightLbs, state.weight)) return false;
  if (!inRange(h.year, state.year)) return false;
  if (state.beds && (h.bedrooms ?? 0) < state.beds) return false;
  if (state.baths && (h.bathrooms ?? 0) < state.baths) return false;
  if (state.sleeps && (h.sleeps ?? 0) < state.sleeps) return false;
  if (state.lofts && (h.lofts ?? 0) < state.lofts) return false;
  if (state.types.size && (!h.type || !state.types.has(h.type))) return false;
  if (state.manufacturers.size && (!h.manufacturer || !state.manufacturers.has(h.manufacturer)))
    return false;
  if (state.states.size && (!h.state || !state.states.has(h.state))) return false;
  if (state.purchaseTypes.size && (!h.purchaseType || !state.purchaseTypes.has(h.purchaseType)))
    return false;
  return true;
}

/** Range filters only apply to homes that HAVE the value; missing values pass
 *  unless the user has narrowed the range away from the full bounds. */
function inRange(value: number | null, range: RangeFilter | null): boolean {
  if (!range) return true;
  if (value == null) return false;
  return value >= range.min && value <= range.max;
}

function sortHomes(homes: TinyHome[]): TinyHome[] {
  const by =
    (sel: (h: TinyHome) => number | null, dir: 1 | -1) =>
    (a: TinyHome, b: TinyHome) => {
      const av = sel(a);
      const bv = sel(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // missing values sink to the bottom
      if (bv == null) return -1;
      return (av - bv) * dir;
    };
  const cmp: Record<SortKey, (a: TinyHome, b: TinyHome) => number> = {
    "price-asc": by((h) => h.price, 1),
    "price-desc": by((h) => h.price, -1),
    "ppsf-asc": by(pricePerSqft, 1),
    "sqft-asc": by((h) => h.sqft, 1),
    "sqft-desc": by((h) => h.sqft, -1),
    newest: (a, b) => (b.listedAt ?? "").localeCompare(a.listedAt ?? ""),
  };
  return [...homes].sort(cmp[state.sort]);
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function render() {
  FILTERED = sortHomes(HOMES.filter(matches));
  const n = FILTERED.length;
  const grid = el("grid");

  el("result-count").textContent = `${n.toLocaleString()} of ${HOMES.length.toLocaleString()} tiny homes`;
  el("footer-stats").textContent = `${HOMES.length.toLocaleString()} homes · ${MANUFACTURERS.length} builders · ${STATES.length} regions`;
  el("apply").textContent = n ? `Show ${n.toLocaleString()} ${n === 1 ? "home" : "homes"}` : "No matches";

  grid.innerHTML = "";
  rendered = 0;
  el("empty").hidden = n > 0;
  if (n) appendChunk();
  syncUrl();
}

/** Append the next page of cards; called on render and on scroll-near-bottom. */
function appendChunk() {
  const slice = FILTERED.slice(rendered, rendered + CHUNK);
  if (!slice.length) return;
  el("grid").insertAdjacentHTML("beforeend", slice.map(card).join(""));
  rendered += slice.length;
}

function card(h: TinyHome): string {
  const img = h.imageUrl
    ? `<img loading="lazy" src="${esc(h.imageUrl)}" alt="${esc(h.title)}" onerror="this.parentElement.classList.add('noimg');this.remove();" />`
    : "";
  const specs: string[] = [];
  if (h.sqft != null) specs.push(spec(`${h.sqft}`, "ft²"));
  if (h.bedrooms != null) specs.push(spec(`${h.bedrooms}`, h.bedrooms === 1 ? "bed" : "beds"));
  if (h.bathrooms != null) specs.push(spec(`${h.bathrooms}`, "bath"));
  if (h.lengthFt != null) specs.push(spec(`${h.lengthFt}`, "ft long"));
  if (h.weightLbs != null) specs.push(spec(`${(h.weightLbs / 1000).toFixed(1)}k`, "lb"));

  const loc = [h.city, h.state].filter(Boolean).join(", ");
  const ppsf = pricePerSqft(h);
  return `
  <a class="ti-card" href="${esc(h.sourceUrl)}" target="_blank" rel="noopener noreferrer">
    <div class="ti-thumb${h.imageUrl ? "" : " noimg"}">
      ${img}
      ${h.type ? `<span class="ti-type">${esc(h.type)}</span>` : ""}
      ${h.price != null ? `<span class="ti-price">$${h.price.toLocaleString()}</span>` : `<span class="ti-price ti-price--na">Inquire</span>`}
    </div>
    <div class="ti-body">
      <h3 class="ti-title">${esc(h.title)}</h3>
      <div class="ti-meta">
        ${h.manufacturer ? `<span class="ti-builder">${esc(h.manufacturer)}</span>` : ""}
        ${loc ? `<span class="ti-loc">${esc(loc)}</span>` : ""}
        ${ppsf != null ? `<span class="ti-ppsf">$${Math.round(ppsf).toLocaleString()}/ft²</span>` : ""}
      </div>
      ${specs.length ? `<ul class="ti-specs">${specs.join("")}</ul>` : ""}
    </div>
  </a>`;
}

function spec(value: string, unit: string): string {
  return `<li><b>${esc(value)}</b><span>${esc(unit)}</span></li>`;
}

/* ------------------------------------------------------------------ */
/* Filter UI construction                                              */
/* ------------------------------------------------------------------ */

function buildSortControl() {
  const sel = el<HTMLSelectElement>("sort");
  sel.innerHTML = SORTS.map((s) => `<option value="${s.key}">${s.label}</option>`).join("");
  sel.value = state.sort;
  sel.addEventListener("change", () => {
    state.sort = sel.value as SortKey;
    render();
  });
}

/** A range filter is only worth showing when several homes carry the value
 *  and the bounds actually span a range. */
function hasSpan(sel: (h: TinyHome) => number | null, bounds: RangeFilter): boolean {
  if (bounds.max <= bounds.min) return false;
  return HOMES.filter((h) => Number.isFinite(sel(h) ?? NaN)).length >= 3;
}
function hasAny(sel: (h: TinyHome) => number | null): boolean {
  return HOMES.some((h) => Number.isFinite(sel(h) ?? NaN));
}

function buildFilters() {
  const root = el("filter-groups");
  root.innerHTML = "";

  if (hasSpan((h) => h.price, BOUNDS.price))
    root.appendChild(rangeGroup("Price", "price", BOUNDS.price, (v) => `$${v.toLocaleString()}`));
  if (hasSpan((h) => h.sqft, BOUNDS.sqft))
    root.appendChild(rangeGroup("Square feet", "sqft", BOUNDS.sqft, (v) => `${v} ft²`));
  if (hasSpan((h) => h.lengthFt, BOUNDS.length))
    root.appendChild(rangeGroup("Length", "length", BOUNDS.length, (v) => `${v} ft`));
  if (hasSpan((h) => h.widthFt, BOUNDS.width))
    root.appendChild(rangeGroup("Width", "width", BOUNDS.width, (v) => `${v} ft`));
  if (hasSpan((h) => h.weightLbs, BOUNDS.weight))
    root.appendChild(
      rangeGroup("Weight", "weight", BOUNDS.weight, (v) => `${v.toLocaleString()} lb`),
    );
  if (hasSpan((h) => h.year, BOUNDS.year))
    root.appendChild(rangeGroup("Year", "year", BOUNDS.year, (v) => `${v}`));

  if (hasAny((h) => h.bedrooms)) root.appendChild(minChips("Bedrooms", "beds", [1, 2, 3]));
  if (hasAny((h) => h.bathrooms)) root.appendChild(minChips("Bathrooms", "baths", [1, 2]));
  if (hasAny((h) => h.lofts)) root.appendChild(minChips("Lofts", "lofts", [1, 2]));
  if (hasAny((h) => h.sleeps)) root.appendChild(minChips("Sleeps", "sleeps", [2, 4, 6]));

  const presentTypes = TINY_HOME_TYPES.filter((t) => HOMES.some((h) => h.type === t));
  if (presentTypes.length > 1)
    root.appendChild(
      multiChips("Type", "types", presentTypes, (o) => o, (t) => countBy("type", t)),
    );

  const purchaseOpts = uniqueStrings(HOMES.map((h) => h.purchaseType));
  if (purchaseOpts.length > 1)
    root.appendChild(
      multiChips("Offer", "purchaseTypes", purchaseOpts, prettyPurchase, (o) => countBy("purchaseType", o)),
    );

  if (MANUFACTURERS.length) root.appendChild(multiList("Builder", "manufacturers", MANUFACTURERS));
  if (STATES.length) root.appendChild(multiList("Location", "states", STATES));
}

const PURCHASE_LABELS: Record<string, string> = {
  purchase: "For sale",
  rent: "For rent",
  model_purchase: "Build to order",
};
function prettyPurchase(raw: string): string {
  return PURCHASE_LABELS[raw] ?? raw;
}
function uniqueStrings(vals: (string | null)[]): string[] {
  return [...new Set(vals.filter((v): v is string => !!v))];
}

type RangeField = "price" | "sqft" | "length" | "width" | "weight" | "year";

function rangeGroup(
  label: string,
  field: RangeField,
  bounds: RangeBound,
  fmt: (v: number) => string,
): HTMLElement {
  const group = section(label);
  if (bounds.max <= bounds.min) {
    group.appendChild(node("p", "filter-note", "—"));
    return group;
  }
  // Seed thumbs from current state; an Infinity upper means "at the cap".
  const cur = state[field];
  const startLo = cur ? Math.max(bounds.min, cur.min) : bounds.min;
  const startHi = cur && Number.isFinite(cur.max) ? Math.min(bounds.max, cur.max) : bounds.max;

  const wrap = node("div", "dualrange");
  const track = node("div", "dr-track");
  const fill = node("div", "dr-fill");
  track.appendChild(fill);

  const lo = sliderInput(bounds, startLo, `${label} minimum`);
  const hi = sliderInput(bounds, startHi, `${label} maximum`);

  const out = node("div", "dr-out");
  const outLo = node("span", "");
  const outHi = node("span", "");
  out.append(outLo, node("span", "dr-dash", "–"), outHi);

  const labelHi = (b: number) => fmt(b) + (b >= bounds.max && bounds.capped ? "+" : "");
  const paint = () => {
    // Prevent the thumbs from crossing.
    let a = Number(lo.value);
    let b = Number(hi.value);
    if (a > b) {
      if (document.activeElement === lo) hi.value = String((b = a));
      else lo.value = String((a = b));
    }
    const span = bounds.max - bounds.min || 1;
    fill.style.left = `${((a - bounds.min) / span) * 100}%`;
    fill.style.right = `${100 - ((b - bounds.min) / span) * 100}%`;
    outLo.textContent = fmt(a);
    outHi.textContent = labelHi(b);
    lo.setAttribute("aria-valuetext", fmt(a));
    hi.setAttribute("aria-valuetext", labelHi(b));
    // Raise whichever thumb sits at the far right so it stays grabbable.
    lo.style.zIndex = a > bounds.max - (bounds.max - bounds.min) * 0.04 ? "4" : "3";
  };
  const commit = () => {
    const a = Number(lo.value);
    const b = Number(hi.value);
    const atMin = a <= bounds.min;
    const atMax = b >= bounds.max;
    state[field] = atMin && atMax ? null : { min: a, max: atMax && bounds.capped ? Infinity : b };
    render();
  };
  lo.addEventListener("input", paint);
  hi.addEventListener("input", paint);
  lo.addEventListener("change", commit);
  hi.addEventListener("change", commit);

  wrap.append(track, lo, hi, out);
  group.appendChild(wrap);
  paint();
  return group;
}

function sliderInput(bounds: RangeBound, value: number, ariaLabel: string): HTMLInputElement {
  const i = document.createElement("input");
  i.type = "range";
  i.min = String(bounds.min);
  i.max = String(bounds.max);
  i.step = String(bounds.step);
  i.value = String(value);
  i.setAttribute("aria-label", ariaLabel);
  return i;
}

type MinField = "beds" | "baths" | "sleeps" | "lofts";

function minChips(label: string, field: MinField, options: number[]): HTMLElement {
  const group = section(label);
  const row = node("div", "chips");
  const make = (val: number, text: string) => {
    const b = node("button", "chip", text) as HTMLButtonElement;
    b.type = "button";
    const on = state[field] === val;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
    b.addEventListener("click", () => {
      state[field] = state[field] === val ? 0 : val;
      row.querySelectorAll<HTMLButtonElement>(".chip").forEach((c) => {
        const sel = c === b && state[field] === val;
        c.classList.toggle("on", sel);
        c.setAttribute("aria-pressed", String(sel));
      });
      render();
    });
    return b;
  };
  row.appendChild(make(0, "Any"));
  options.forEach((o) => row.appendChild(make(o, `${o}+`)));
  group.appendChild(row);
  return group;
}

type SetField = "types" | "manufacturers" | "states" | "purchaseTypes";

function multiChips(
  label: string,
  field: SetField,
  options: readonly string[],
  labelFn: (o: string) => string = (o) => o,
  countFn?: (o: string) => number,
): HTMLElement {
  const group = section(label);
  if (!options.length) {
    group.appendChild(node("p", "filter-note", "—"));
    return group;
  }
  const row = node("div", "chips");
  options.forEach((opt) => {
    const b = node("button", "chip") as HTMLButtonElement;
    b.type = "button";
    b.append(node("span", "", labelFn(opt)));
    if (countFn) b.append(node("span", "chip-count", String(countFn(opt))));
    const on = state[field].has(opt);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
    b.addEventListener("click", () => {
      toggleSet(state[field], opt);
      const active = state[field].has(opt);
      b.classList.toggle("on", active);
      b.setAttribute("aria-pressed", String(active));
      render();
    });
    row.appendChild(b);
  });
  group.appendChild(row);
  return group;
}

/** Total homes carrying a given categorical value (for facet count badges). */
function countBy(key: "type" | "purchaseType", value: string): number {
  return HOMES.reduce((n, h) => n + (h[key] === value ? 1 : 0), 0);
}

function multiList(label: string, field: SetField, options: string[]): HTMLElement {
  const group = section(`${label}${state[field].size ? ` · ${state[field].size}` : ""}`);
  if (!options.length) {
    group.appendChild(node("p", "filter-note", "—"));
    return group;
  }
  const search = document.createElement("input");
  search.type = "search";
  search.className = "list-search";
  search.placeholder = `Filter ${label.toLowerCase()}…`;

  const list = node("div", "checklist");
  const counts = new Map<string, number>();
  for (const opt of options) {
    counts.set(opt, HOMES.filter((h) => (h as any)[singular(field)] === opt).length);
  }

  const draw = (q: string) => {
    list.innerHTML = "";
    options
      .filter((o) => o.toLowerCase().includes(q.toLowerCase()))
      .forEach((opt) => {
        const row = node("label", "check");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = state[field].has(opt);
        cb.addEventListener("change", () => {
          if (cb.checked) state[field].add(opt);
          else state[field].delete(opt);
          updateSectionTitle(group, label, state[field].size);
          render();
        });
        row.appendChild(cb);
        row.appendChild(node("span", "check-label", opt));
        row.appendChild(node("span", "check-count", String(counts.get(opt) ?? 0)));
        list.appendChild(row);
      });
  };
  search.addEventListener("input", () => draw(search.value));
  draw("");

  group.appendChild(search);
  group.appendChild(list);
  return group;
}

function singular(field: SetField): keyof TinyHome {
  return field === "manufacturers" ? "manufacturer" : field === "states" ? "state" : "type";
}

/* ------------------------------------------------------------------ */
/* Small DOM helpers                                                   */
/* ------------------------------------------------------------------ */

function section(title: string): HTMLElement {
  const s = node("section", "filter-group");
  s.dataset.title = title;
  s.appendChild(node("h4", "filter-title", title));
  return s;
}

function updateSectionTitle(group: HTMLElement, label: string, count: number) {
  const h = group.querySelector(".filter-title");
  if (h) h.textContent = `${label}${count ? ` · ${count}` : ""}`;
}

function toggleSet(set: Set<string>, val: string) {
  if (set.has(val)) set.delete(val);
  else set.add(val);
}

function node(tag: string, cls = "", text = ""): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e as T;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/* ------------------------------------------------------------------ */
/* Global controls + URL state                                         */
/* ------------------------------------------------------------------ */

function wireGlobalControls() {
  const search = el<HTMLInputElement>("search");
  search.value = state.search;
  let t: ReturnType<typeof setTimeout>;
  search.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.search = search.value.trim();
      render();
    }, 150);
  });

  const toggle = el("filter-toggle");
  const setDrawer = (open: boolean) => {
    document.body.classList.toggle("filters-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    el("scrim").hidden = !open;
  };
  toggle.addEventListener("click", () => setDrawer(!document.body.classList.contains("filters-open")));
  el("scrim").addEventListener("click", () => setDrawer(false));
  el("apply").addEventListener("click", () => setDrawer(false));
  el("close-filters").addEventListener("click", () => setDrawer(false));
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("filters-open")) setDrawer(false);
  });

  el("reset").addEventListener("click", resetAll);
  el("reset-empty").addEventListener("click", resetAll);
}

function resetAll() {
  state.search = "";
  state.price = state.sqft = state.length = state.width = state.weight = state.year = null;
  state.beds = state.baths = state.sleeps = state.lofts = 0;
  state.types.clear();
  state.manufacturers.clear();
  state.states.clear();
  state.purchaseTypes.clear();
  el<HTMLInputElement>("search").value = "";
  buildFilters();
  render();
}

function syncUrl() {
  const p = new URLSearchParams();
  if (state.search) p.set("q", state.search);
  if (state.sort !== "newest") p.set("sort", state.sort);
  if (state.beds) p.set("beds", String(state.beds));
  if (state.baths) p.set("baths", String(state.baths));
  if (state.sleeps) p.set("sleeps", String(state.sleeps));
  if (state.lofts) p.set("lofts", String(state.lofts));
  const rng = (r: RangeFilter) => `${r.min}-${Number.isFinite(r.max) ? r.max : "max"}`;
  if (state.price) p.set("price", rng(state.price));
  if (state.sqft) p.set("sqft", rng(state.sqft));
  if (state.length) p.set("len", rng(state.length));
  if (state.width) p.set("wid", rng(state.width));
  if (state.weight) p.set("wt", rng(state.weight));
  if (state.year) p.set("year", rng(state.year));
  if (state.types.size) p.set("type", [...state.types].join("|"));
  if (state.purchaseTypes.size) p.set("offer", [...state.purchaseTypes].join("|"));
  if (state.manufacturers.size) p.set("builder", [...state.manufacturers].join("|"));
  if (state.states.size) p.set("loc", [...state.states].join("|"));
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  state.search = p.get("q") ?? "";
  const sort = p.get("sort") as SortKey | null;
  if (sort && SORTS.some((s) => s.key === sort)) state.sort = sort;
  state.beds = Number(p.get("beds")) || 0;
  state.baths = Number(p.get("baths")) || 0;
  state.sleeps = Number(p.get("sleeps")) || 0;
  state.lofts = Number(p.get("lofts")) || 0;
  parseRange(p.get("price"), "price");
  parseRange(p.get("sqft"), "sqft");
  parseRange(p.get("len"), "length");
  parseRange(p.get("wid"), "width");
  parseRange(p.get("wt"), "weight");
  parseRange(p.get("year"), "year");
  for (const v of (p.get("type") ?? "").split("|").filter(Boolean)) state.types.add(v);
  for (const v of (p.get("offer") ?? "").split("|").filter(Boolean)) state.purchaseTypes.add(v);
  for (const v of (p.get("builder") ?? "").split("|").filter(Boolean)) state.manufacturers.add(v);
  for (const v of (p.get("loc") ?? "").split("|").filter(Boolean)) state.states.add(v);
}

function parseRange(raw: string | null, field: RangeField) {
  if (!raw) return;
  const [lo, hi] = raw.split("-");
  const a = Number(lo);
  const b = hi === "max" ? Infinity : Number(hi);
  if (Number.isFinite(a) && (b === Infinity || Number.isFinite(b))) state[field] = { min: a, max: b };
}

boot().catch((err) => {
  console.error(err);
  el("result-count").textContent = "Failed to load directory.";
});
