import type { WebInfo, WebMap } from "./asics";

export type Group = "Discounted" | "Non-discounted";
export type CG = "Men" | "Women";
export type FileGender = "Men" | "Women" | "Unisex";
export const GROUPS: Group[] = ["Discounted", "Non-discounted"];

export interface CategoryRule { code: string; label: string; high_from: number }
export interface D2CSettings {
  brand: string;
  min_soh: number;             // per-size SOH needed in the file
  men_core: string[];          // all must have SOH ≥ min_soh and be live on the website
  women_min_sizes: number;     // any N sizes with SOH ≥ min_soh and live on the website
  include_unisex: boolean;     // Unisex goes into both Men and Women campaigns
  categories: CategoryRule[];  // High AOV when sale price ≥ high_from
}
export interface D2CConfig { settings: D2CSettings }

export const D2C_DEFAULTS: D2CSettings = {
  brand: "ASICS",
  min_soh: 20,
  men_core: ["7", "8", "9", "10"],
  women_min_sizes: 4,
  include_unisex: true,
  categories: [
    { code: "PRUN", label: "Running", high_from: 6000 },
    { code: "SPS", label: "Sneakers", high_from: 5000 },
    { code: "CPS", label: "Sports shoes (cricket, tennis, court)", high_from: 6000 },
  ],
};

/** Stored per upload: [sku, product name, option, category, gender, legends, season, MRP, SOH, discount (0–1)] */
export type D2CTuple = [string, string, string, string, string, string, string, number, number, number];
export interface D2CRow {
  sku: string; name: string; option: string; category: string; gender: string; legends: string; season: string;
  mrp: number; soh: number; disc: number; size: string;
}
export const fromTuple = (t: D2CTuple): D2CRow => ({
  sku: t[0], name: t[1], option: t[2], category: t[3], gender: t[4], legends: t[5], season: t[6],
  mrp: t[7], soh: t[8], disc: t[9], size: t[0].includes(".") ? t[0].slice(t[0].lastIndexOf(".") + 1).trim() : "",
});

export const sizeKey = (s: string) => {
  const n = parseFloat(s.replace(/H$/i, ""));
  return Number.isFinite(n) ? n + (/H$/i.test(s) ? 0.5 : 0) : 999;
};
export const sortSizes = (a: string[]) => [...a].sort((x, y) => sizeKey(x) - sizeKey(y));

const TYPE: Record<string, string | null> = {
  running: "Running", "trail-running": "Trail running", tennis: "Tennis", cricket: "Cricket",
  "indoor-court": "Indoor court (badminton/squash)", sportstyle: "Sportstyle (lifestyle sneaker)",
  "indoor-sport": null, "men-s-running-footwear": null,
};
export const shoeType = (w?: WebInfo) =>
  w ? [...new Set(w.types.map((t) => (t in TYPE ? TYPE[t] : t)).filter(Boolean))].join(" / ") : "";

export interface SizeLine { size: string; soh: number; sku: string }
export type ArtStatus = "Listed" | "Excluded" | "Not checked";
export interface Article {
  key: string;               // `${cg}|${option}`
  option: string; name: string; category: string; gender: FileGender; cg: CG; group: Group;
  legends: string; season: string; mrp: number; disc: number; sale: number;
  aov: "High AOV" | "Low AOV"; campaign: string;
  good: SizeLine[];          // sizes with SOH ≥ min in the file
  rows: SizeLine[];          // sizes that go into the lists (good ∩ live on website)
  web?: WebInfo; type: string;
  status: ArtStatus; reason: string;
}
export interface D2CCampaign { group: Group; name: string; cg: CG; category: string; aov: "High AOV" | "Low AOV"; articles: Article[] }
export interface D2CResult { articles: Article[]; campaigns: D2CCampaign[] }

export const campaignNames = (st: D2CSettings) =>
  (["Men", "Women"] as CG[]).flatMap((cg) => st.categories.flatMap((c) => (["High AOV", "Low AOV"] as const).map((aov) => ({ cg, category: c.code, aov, name: `${cg} ${c.code} ${aov}` }))));

/**
 * web = null → file rule only (no website check yet).
 * web given → an option missing from the map counts as "Not checked".
 */
export function processD2C(rows: D2CRow[], st: D2CSettings, web: WebMap | null): D2CResult {
  const cats = new Map(st.categories.map((c) => [c.code, c]));
  const byOpt = new Map<string, D2CRow[]>();
  for (const r of rows) {
    const g = r.gender.toUpperCase();
    if (!cats.has(r.category) || !r.size || /^K/i.test(r.size)) continue;
    if (!(g === "MEN" || g === "WOMEN" || (g === "UNISEX" && st.include_unisex))) continue;
    const a = byOpt.get(r.option) ?? []; a.push(r); byOpt.set(r.option, a);
  }
  const articles: Article[] = [];
  for (const [option, rs] of byOpt) {
    const f = rs[0];
    const g = f.gender.toUpperCase();
    const gender: FileGender = g === "MEN" ? "Men" : g === "WOMEN" ? "Women" : "Unisex";
    const perSize = new Map<string, SizeLine>();
    for (const r of rs) {
      const e = perSize.get(r.size);
      if (e) e.soh += r.soh; else perSize.set(r.size, { size: r.size, soh: r.soh, sku: r.sku });
    }
    const good = [...perSize.values()].filter((x) => x.soh >= st.min_soh).sort((x, y) => sizeKey(x.size) - sizeKey(y.size));
    const goodSet = new Set(good.map((x) => x.size));
    const cgs: CG[] = [];
    if (gender !== "Women" && st.men_core.every((c) => goodSet.has(c))) cgs.push("Men");
    if (gender !== "Men" && good.length >= st.women_min_sizes) cgs.push("Women");
    const disc = f.disc;
    const sale = Math.round(f.mrp * (1 - disc));
    const aov = sale >= (cats.get(f.category)?.high_from ?? Infinity) ? "High AOV" : "Low AOV";
    const w = web?.[option];
    for (const cg of cgs) {
      let status: ArtStatus = "Listed", reason = "", out = good;
      if (web && !w) { status = "Not checked"; reason = "Not checked on the website — run the website check again"; }
      else if (w) {
        const live = new Set(w.live);
        out = good.filter((x) => live.has(x.size));
        if (!w.found) { status = "Excluded"; reason = "Not on website"; }
        else if (!w.inStock) { status = "Excluded"; reason = "Out of stock on website"; }
        else if (cg === "Men") {
          const miss = st.men_core.filter((c) => !live.has(c));
          if (miss.length) { status = "Excluded"; reason = `Core size out of stock on website: ${miss.join(", ")}`; }
        } else if (out.length < st.women_min_sizes) {
          status = "Excluded"; reason = `Only ${out.length} size(s) with SOH ≥ ${st.min_soh} live on website (${out.map((x) => x.size).join(", ") || "none"})`;
        }
      } else status = "Not checked";
      articles.push({
        key: `${cg}|${option}`, option, name: f.name, category: f.category, gender, cg,
        group: disc > 0 ? "Discounted" : "Non-discounted", legends: f.legends, season: f.season,
        mrp: f.mrp, disc, sale, aov, campaign: `${cg} ${f.category} ${aov}`,
        good, rows: status === "Excluded" ? [] : out, web: w, type: shoeType(w), status, reason,
      });
    }
  }
  const total = (a: Article) => a.rows.reduce((s, x) => s + x.soh, 0);
  articles.sort((a, b) => total(b) - total(a) || a.option.localeCompare(b.option));
  const campaigns: D2CCampaign[] = [];
  for (const group of GROUPS)
    for (const c of campaignNames(st))
      campaigns.push({ group, ...c, articles: articles.filter((a) => a.group === group && a.campaign === c.name && (a.status === "Listed" || (!web && a.status === "Not checked"))) });
  return { articles, campaigns };
}

// ---------- runs & pause register ----------
export interface D2CRunMeta { id: string; at: string; snapshotId: string; options: number; notFound: number; failed: number; listed: number }
export interface ActiveInfo { group: Group; campaign: string; name: string; gender: FileGender; skus: string[] }
export interface D2CRun extends D2CRunMeta { web: WebMap; active: Record<string, ActiveInfo> }  // listed key → what was listed

export type RegState = "To pause" | "Paused" | "Resumed";
export interface D2CRegEntry {
  key: string; cg: CG; option: string; name: string; group?: Group; campaign: string; gender: FileGender;
  state: RegState; reason: string; skus: string[];
  flaggedOn: string; pausedOn?: string; resumedOn?: string;
  latest: "Active" | "Pause"; lastCheckedAt: string;
}
export type D2CRegister = Record<string, D2CRegEntry>;

/**
 * prevActive = keys (with their listed skus) from the previous website check.
 * An article that was listed before (or is already in the register) and is no longer listed → "To pause".
 * Articles whose check failed this time are left alone.
 */
export function applyD2CRun(reg: D2CRegister, prevActive: Record<string, ActiveInfo>, res: D2CResult, at: string): D2CRegister {
  const next: D2CRegister = { ...reg };
  const byKey = new Map(res.articles.map((a) => [a.key, a]));
  const listed = new Set(res.articles.filter((a) => a.status === "Listed").map((a) => a.key));
  const watch = new Set([...Object.keys(prevActive), ...Object.keys(reg)]);
  for (const k of watch) {
    const a = byKey.get(k);
    const e = next[k];
    if (a?.status === "Not checked") continue;
    if (listed.has(k)) {
      if (!e) continue;
      if (e.state === "To pause") delete next[k];
      else next[k] = { ...e, latest: "Active", lastCheckedAt: at, group: a!.group, campaign: a!.campaign };
      continue;
    }
    const [cg, option] = k.split("|") as [CG, string];
    const reason = a?.reason || `No longer meets the stock rule in the upload`;
    if (!e || e.state === "Resumed") {
      const p = prevActive[k];
      next[k] = { key: k, cg, option, name: a?.name ?? p?.name ?? e?.name ?? "", group: p?.group ?? e?.group ?? a?.group, campaign: p?.campaign ?? e?.campaign ?? a?.campaign ?? "",
        gender: a?.gender ?? p?.gender ?? e?.gender ?? cg, state: "To pause", reason, skus: p?.skus ?? e?.skus ?? [],
        flaggedOn: at, latest: "Pause", lastCheckedAt: at };
    } else next[k] = { ...e, reason, latest: "Pause", lastCheckedAt: at };
  }
  return next;
}

export const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";

export const activeOf = (res: D2CResult): Record<string, ActiveInfo> =>
  Object.fromEntries(res.articles.filter((a) => a.status === "Listed").map((a) => [a.key, { group: a.group, campaign: a.campaign, name: a.name, gender: a.gender, skus: a.rows.map((x) => x.sku) }]));

/** What changed between two website checks — what to add / move / remove in Meta and Google. */
export function diffRuns(prev: Record<string, ActiveInfo> | null, cur: Record<string, ActiveInfo>) {
  if (!prev) return null;
  const added = Object.keys(cur).filter((k) => !prev[k]);
  const removed = Object.keys(prev).filter((k) => !cur[k]);
  const moved = Object.keys(cur).filter((k) => prev[k] && (prev[k].campaign !== cur[k].campaign || prev[k].group !== cur[k].group));
  return { added, removed, moved };
}
