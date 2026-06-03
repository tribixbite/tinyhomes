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
  | "sqft-asc"
  | "sqft-desc"
  | "year-desc"
  | "newest";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "newest", label: "Recently listed" },
  { key: "price-asc", label: "Price: low → high" },
  { key: "price-desc", label: "Price: high → low" },
  { key: "sqft-asc", label: "Size: small → large" },
  { key: "sqft-desc", label: "Size: large → small" },
];

/** Bounds computed from the dataset, used to seed the range sliders. */
interface Bounds {
  price: RangeFilter;
  sqft: RangeFilter;
  length: RangeFilter;
  width: RangeFilter;
  weight: RangeFilter;
  year: RangeFilter;
}

let HOMES: TinyHome[] = [];
let BOUNDS: Bounds;
let MANUFACTURERS: string[] = [];
let STATES: string[] = [];

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
  render();
}

/* ------------------------------------------------------------------ */
/* Derivation helpers                                                  */
/* ------------------------------------------------------------------ */

function computeBounds(homes: TinyHome[]): Bounds {
  const span = (vals: number[], padLo = 0, padHi = 0): RangeFilter => {
    const nums = vals.filter((v) => Number.isFinite(v));
    if (!nums.length) return { min: 0, max: 0 };
    return { min: Math.floor(Math.min(...nums)) - padLo, max: Math.ceil(Math.max(...nums)) + padHi };
  };
  return {
    price: span(homes.map((h) => h.price ?? NaN)),
    sqft: span(homes.map((h) => h.sqft ?? NaN)),
    length: span(homes.map((h) => h.lengthFt ?? NaN)),
    width: span(homes.map((h) => h.widthFt ?? NaN)),
    weight: span(homes.map((h) => h.weightLbs ?? NaN)),
    year: span(homes.map((h) => h.year ?? NaN)),
  };
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
    "sqft-asc": by((h) => h.sqft, 1),
    "sqft-desc": by((h) => h.sqft, -1),
    "year-desc": by((h) => h.year, -1),
    newest: (a, b) => (b.listedAt ?? "").localeCompare(a.listedAt ?? ""),
  };
  return [...homes].sort(cmp[state.sort]);
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function render() {
  const filtered = sortHomes(HOMES.filter(matches));
  const grid = el("grid");
  const empty = el("empty");

  el("result-count").textContent = `${filtered.length.toLocaleString()} of ${HOMES.length.toLocaleString()} tiny homes`;
  el("footer-stats").textContent = `${HOMES.length.toLocaleString()} homes · ${MANUFACTURERS.length} builders · ${STATES.length} regions`;

  if (!filtered.length) {
    grid.innerHTML = "";
    empty.hidden = false;
  } else {
    empty.hidden = true;
    grid.innerHTML = filtered.map(card).join("");
  }
  syncUrl();
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
  const root = el("filters");
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
  if (presentTypes.length > 1) root.appendChild(multiChips("Type", "types", presentTypes));

  const purchaseOpts = uniqueStrings(HOMES.map((h) => h.purchaseType));
  if (purchaseOpts.length > 1)
    root.appendChild(multiChips("Offer", "purchaseTypes", purchaseOpts, prettyPurchase));

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
  bounds: RangeFilter,
  fmt: (v: number) => string,
): HTMLElement {
  const group = section(label);
  if (bounds.max <= bounds.min) {
    group.appendChild(node("p", "filter-note", "—"));
    return group;
  }
  const cur = state[field] ?? { ...bounds };
  const wrap = node("div", "dualrange");

  const track = node("div", "dr-track");
  const fill = node("div", "dr-fill");
  track.appendChild(fill);

  const lo = sliderInput(bounds, cur.min);
  const hi = sliderInput(bounds, cur.max);

  const out = node("div", "dr-out");
  const outLo = node("span", "", fmt(cur.min));
  const outHi = node("span", "", fmt(cur.max));
  out.append(outLo, node("span", "dr-dash", "–"), outHi);

  const paint = () => {
    let a = Number(lo.value);
    let b = Number(hi.value);
    if (a > b) [a, b] = [b, a];
    const range = bounds.max - bounds.min || 1;
    const lp = ((a - bounds.min) / range) * 100;
    const hp = ((b - bounds.min) / range) * 100;
    fill.style.left = `${lp}%`;
    fill.style.right = `${100 - hp}%`;
    outLo.textContent = fmt(a);
    outHi.textContent = fmt(b);
  };
  const commit = () => {
    let a = Number(lo.value);
    let b = Number(hi.value);
    if (a > b) [a, b] = [b, a];
    state[field] = a <= bounds.min && b >= bounds.max ? null : { min: a, max: b };
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

function sliderInput(bounds: RangeFilter, value: number): HTMLInputElement {
  const i = document.createElement("input");
  i.type = "range";
  i.min = String(bounds.min);
  i.max = String(bounds.max);
  i.step = String(Math.max(1, Math.round((bounds.max - bounds.min) / 200)));
  i.value = String(value);
  return i;
}

type MinField = "beds" | "baths" | "sleeps" | "lofts";

function minChips(label: string, field: MinField, options: number[]): HTMLElement {
  const group = section(label);
  const row = node("div", "chips");
  const make = (val: number, text: string) => {
    const b = node("button", "chip", text) as HTMLButtonElement;
    b.type = "button";
    if (state[field] === val) b.classList.add("on");
    b.addEventListener("click", () => {
      state[field] = state[field] === val ? 0 : val;
      row.querySelectorAll(".chip").forEach((c) => c.classList.remove("on"));
      if (state[field] === val) b.classList.add("on");
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
): HTMLElement {
  const group = section(label);
  if (!options.length) {
    group.appendChild(node("p", "filter-note", "—"));
    return group;
  }
  const row = node("div", "chips");
  options.forEach((opt) => {
    const b = node("button", "chip", labelFn(opt)) as HTMLButtonElement;
    b.type = "button";
    if (state[field].has(opt)) b.classList.add("on");
    b.addEventListener("click", () => {
      toggleSet(state[field], opt);
      b.classList.toggle("on");
      render();
    });
    row.appendChild(b);
  });
  group.appendChild(row);
  return group;
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
  toggle.addEventListener("click", () => {
    const open = document.body.classList.toggle("filters-open");
    toggle.setAttribute("aria-expanded", String(open));
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
  if (state.price) p.set("price", `${state.price.min}-${state.price.max}`);
  if (state.sqft) p.set("sqft", `${state.sqft.min}-${state.sqft.max}`);
  if (state.length) p.set("len", `${state.length.min}-${state.length.max}`);
  if (state.width) p.set("wid", `${state.width.min}-${state.width.max}`);
  if (state.weight) p.set("wt", `${state.weight.min}-${state.weight.max}`);
  if (state.year) p.set("year", `${state.year.min}-${state.year.max}`);
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
  const [a, b] = raw.split("-").map(Number);
  if (Number.isFinite(a) && Number.isFinite(b)) state[field] = { min: a, max: b };
}

boot().catch((err) => {
  console.error(err);
  el("result-count").textContent = "Failed to load directory.";
});
