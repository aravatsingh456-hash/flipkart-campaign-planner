import * as XLSX from "xlsx";
import type { Campaign, CampaignRule, Settings } from "./defaults";
import { normSize, processInventory, type InvRow } from "./processing";
import type { ArticleCheck } from "./api";
import { regKey, type Register } from "./register";

/** One row of a Flipkart Ads "All FSNs of campaign" report. */
export interface ReportRow {
  fsn: string; name: string; status: string;
  views: number; clicks: number; spend: number; unitsD: number; unitsI: number; revD: number; revI: number;
}
export interface CampaignReport {
  id: string;                 // Flipkart campaign id
  fkName: string;             // Flipkart campaign name
  adgroup: string; start: string; end: string;
  fileName: string; uploadedAt: string;
  planner: string | null;     // linked planner campaign name
  rows: ReportRow[];
  check?: { at: string; results: ArticleCheck[] };
}
export type ReportMeta = Omit<CampaignReport, "rows" | "check"> & { fsns: number; running: number; paused: number; checkedAt?: string };

const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown) => (v == null ? "" : String(v).trim());

/** Parses the Flipkart CSV (a few "key, value" lines on top, then the FSN table). */
export function parseReport(text: string, fileName: string): CampaignReport {
  const lines = text.split(/\r?\n/);
  const head = (re: RegExp) => lines.slice(0, 15).map((l) => re.exec(l)).find(Boolean) ?? null;
  const camp = head(/^\s*Campaign:\s*(.*)\(([A-Z0-9]+)\)\s*,?\s*$/i);
  const ad = head(/^\s*Adgroup:\s*(.*?)\s*,?\s*$/i);
  const st = head(/^\s*Start Time,\s*(.*)$/i);
  const en = head(/^\s*End Time,\s*(.*)$/i);
  const hi = lines.findIndex((l) => /^\s*"?Advertised FSN ID/i.test(l));
  if (hi < 0) throw new Error(`${fileName}: this is not a Flipkart campaign FSN report (no "Advertised FSN ID" column).`);
  const wb = XLSX.read(lines.slice(hi).join("\n"), { type: "string", raw: true });
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null, raw: true });
  const rows: ReportRow[] = data.filter((r) => str(r["Advertised FSN ID"])).map((r) => ({
    fsn: str(r["Advertised FSN ID"]), name: str(r["Advertised Product Name"]), status: str(r["fsn_status"]).toUpperCase(),
    views: num(r["Views"]), clicks: num(r["Clicks"]), spend: num(r["Ad Spend"]),
    unitsD: num(r["Units Sold (Direct)"]), unitsI: num(r["Units Sold (Indirect)"]), revD: num(r["Direct Revenue"]), revI: num(r["Indirect Revenue"]),
  }));
  const firstName = str(data[0]?.["Campaign Name"]);
  const firstId = str(data[0]?.["Campaign ID"]);
  const id = camp?.[2] ?? firstId;
  if (!id) throw new Error(`${fileName}: campaign id not found.`);
  return {
    id, fkName: (camp?.[1] ?? firstName).trim(), adgroup: ad?.[1] ?? "", start: str(st?.[1]).slice(0, 10), end: str(en?.[1]).slice(0, 10),
    fileName, uploadedAt: new Date().toISOString(), planner: null, rows,
  };
}

export const metaOf = (r: CampaignReport): ReportMeta => {
  const { rows, check, ...m } = r;
  return { ...m, fsns: rows.length, running: rows.filter((x) => x.status !== "PAUSED").length, paused: rows.filter((x) => x.status === "PAUSED").length, checkedAt: check?.at };
};

/** Suggested rules for a new planner campaign: per vertical, MRP min–max of the report's FSNs in the current upload. */
export function suggestCampaign(rep: CampaignReport, inv: InvRow[]) {
  const byFsn = new Map(inv.map((r) => [r.fsn, r]));
  const v = new Map<string, { fsns: number; min: number; max: number }>();
  let men = 0, women = 0, missing = 0;
  for (const r of rep.rows) {
    const i = byFsn.get(r.fsn);
    if (/for women/i.test(r.name)) women++; else men++;
    if (!i) { missing++; continue; }
    const e = v.get(i.vertical) ?? { fsns: 0, min: Infinity, max: 0 };
    e.fsns++; e.min = Math.min(e.min, i.mrp); e.max = Math.max(e.max, i.mrp); v.set(i.vertical, e);
  }
  const total = rep.rows.length - missing;
  const verticals = [...v].map(([vertical, e]) => ({ vertical, ...e, share: total ? e.fsns / total : 0 })).sort((a, b) => b.fsns - a.fsns);
  return { gender: (women > men ? "Women" : "Men") as Campaign["gender"], verticals, missing };
}
export const rulesFrom = (vs: { vertical: string; min: number; max: number }[]): CampaignRule[] =>
  vs.map((x) => ({ vertical: x.vertical, mrp_from: x.min, mrp_to: x.max }));

// ---------------- reconciliation ----------------
export type Basis = "Live check" | "Earlier check" | "Stock only";
export interface ActionRow {
  action: string; article: string; model: string; color: string; fsn: string; size: string; qoh: number;
  status: string;            // status in the Flipkart campaign: INDEXED / PAUSED / not in campaign
  liveSizes: string; basis: Basis; reason: string;
  clicks: number; spend: number; revenue: number; roi: number | "";
}
export interface Reconciled {
  newArticles: ActionRow[];   // restocked / qualifying articles that are not in the campaign at all
  addSizes: ActionRow[];      // qualifying sizes of articles already in the campaign
  pause: ActionRow[];
  resume: ActionRow[];
  review: ActionRow[];        // running, fewer sizes than needed for a new add but enough to keep running
  sizeOos: ActionRow[];       // running FSN whose size is not live (Flipkart stops it; optional pause)
  running: ActionRow[];       // fine
  keepPaused: ActionRow[];
  notInUpload: ActionRow[];   // FSN not in the inventory upload
  articlesToCheck: { article: string; itemId: string; fsns: string[] }[];
}

const mode = (a: string[]) => { const m = new Map<string, number>(); a.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1)); return [...m].sort((x, y) => y[1] - x[1])[0]?.[0] ?? ""; };

/**
 * Compares a Flipkart campaign report with the current upload + live check.
 * The campaign's qualifying list is built on its own (ignoring the "first campaign wins" rule),
 * so a broad campaign like a brand campaign is judged on all its products.
 */
export function reconcile(rep: CampaignReport, camp: Campaign, inv: InvRow[], st: Settings, runResults: ArticleCheck[], reg: Register = {}): Reconciled {
  const eligible = processInventory(inv, [{ ...camp, active: true }], st).campaigns[0];
  const eligFsn = new Map(eligible.rows.map((r) => [r.fsn, r]));
  const eligArts = new Set(eligible.articles);
  // inventory per FSN (summed) and per article
  const fsnInv = new Map<string, InvRow & { q: number }>();
  for (const r of inv) { const e = fsnInv.get(r.fsn); if (e) e.q += r.qoh; else fsnInv.set(r.fsn, { ...r, q: r.qoh }); }
  const artFsns = new Map<string, (InvRow & { q: number })[]>();
  for (const r of fsnInv.values()) { const a = artFsns.get(r.article_number) ?? []; a.push(r); artFsns.set(r.article_number, a); }
  // best available check per article: this report's own check, else the latest live check
  const chk = new Map<string, ArticleCheck>();
  for (const r of runResults) if (r.status !== "Check failed") chk.set(r.article, r);
  for (const r of rep.check?.results ?? []) if (r.status !== "Check failed") chk.set(r.article, r);
  // fallback: live sizes remembered in the pause register (latest check of that article in any campaign)
  const regLive = new Map<string, { sizes: string[]; at: string }>();
  for (const e of Object.values(reg)) {
    const p = regLive.get(e.article);
    if (!p || e.lastCheckedAt > p.at) regLive.set(e.article, { sizes: e.liveSizes, at: e.lastCheckedAt });
  }
  const model = new Map<string, string>();
  for (const r of inv) if (r.model_name && !model.has(r.article_number)) model.set(r.article_number, r.model_name);
  const repFsns = new Set(rep.rows.map((r) => r.fsn));
  const repArts = new Set(rep.rows.map((r) => fsnInv.get(r.fsn)?.article_number).filter(Boolean) as string[]);
  // sizes with QOH ≥ min per article (all rows of the article)
  const goodSizes = (art: string) => {
    const m = new Map<string, number>();
    for (const r of artFsns.get(art) ?? []) m.set(normSize(r.uk_size), (m.get(normSize(r.uk_size)) ?? 0) + r.q);
    return [...m].filter(([, q]) => q >= st.min_qoh).map(([s]) => s);
  };
  const live = (art: string) => {
    const c = chk.get(art);
    if (c) return { basis: "Live check" as Basis, sizes: c.liveSizes, ok: c.liveSizes.length >= st.min_live_sizes };
    const rl = regLive.get(art);
    if (rl) return { basis: "Earlier check" as Basis, sizes: rl.sizes, ok: rl.sizes.length >= st.min_live_sizes };
    const g = goodSizes(art).sort((x, y) => parseFloat(x) - parseFloat(y));
    return { basis: "Stock only" as Basis, sizes: g, ok: g.length >= st.min_live_sizes };
  };
  const out: Reconciled = { newArticles: [], addSizes: [], pause: [], resume: [], review: [], sizeOos: [], running: [], keepPaused: [], notInUpload: [], articlesToCheck: [] };
  const mk = (action: string, fsn: string, status: string, reason: string, rr?: ReportRow): ActionRow => {
    const i = fsnInv.get(fsn); const art = i?.article_number ?? "";
    const l = art ? live(art) : { basis: "Stock only" as Basis, sizes: [] as string[] };
    const revenue = (rr?.revD ?? 0) + (rr?.revI ?? 0);
    return {
      action, article: art, model: model.get(art) ?? i?.model_name ?? rr?.name ?? "", color: i?.color ?? "", fsn, size: i ? normSize(i.uk_size) : "", qoh: i?.q ?? 0,
      status, liveSizes: l.sizes.join(", "), basis: l.basis, reason,
      clicks: rr?.clicks ?? 0, spend: rr?.spend ?? 0, revenue, roi: rr && rr.spend ? Math.round((revenue / rr.spend) * 100) / 100 : "",
    };
  };
  // 1) FSNs that are in the campaign
  for (const rr of rep.rows) {
    const i = fsnInv.get(rr.fsn);
    const paused = rr.status === "PAUSED";
    if (!i) { (paused ? out.keepPaused : out.notInUpload).push(mk(paused ? "Keep paused" : "Check / pause", rr.fsn, rr.status, "FSN not in the inventory upload", rr)); continue; }
    const art = i.article_number;
    const l = live(art);
    const sizeLive = l.sizes.includes(normSize(i.uk_size));
    const nGood = goodSizes(art).length;
    if (!l.ok) {
      const why = l.basis !== "Stock only" ? `Only ${l.sizes.length} size(s) live on Flipkart${l.basis === "Earlier check" ? " (earlier check)" : ""}` : `Only ${nGood} size(s) with QOH ≥ ${st.min_qoh}`;
      (paused ? out.keepPaused : out.pause).push(mk(paused ? "Keep paused" : "Pause", rr.fsn, rr.status, why, rr));
    } else if (paused) {
      if (sizeLive && i.q > 0) out.resume.push(mk("Resume", rr.fsn, rr.status, `${l.sizes.length} sizes ${l.basis === "Stock only" ? "in stock (not live-checked)" : "live"}; this size is available`, rr));
      else out.keepPaused.push(mk("Keep paused", rr.fsn, rr.status, "Article is fine but this size is not available", rr));
    } else if (!sizeLive || i.q <= 0) {
      out.sizeOos.push(mk("Size out of stock (optional pause)", rr.fsn, rr.status, i.q <= 0 ? "QOH 0" : "This size is not live / below min QOH", rr));
    } else if (!eligArts.has(art)) {
      out.review.push(mk("Keep running – check", rr.fsn, rr.status, `${nGood} size(s) with QOH ≥ ${st.min_qoh} — below the ${st.min_sizes_select}-size rule for new adds, enough to keep running`, rr));
    } else out.running.push(mk("Running OK", rr.fsn, rr.status, "", rr));
  }
  // 2) qualifying FSNs that are not in the campaign
  for (const [fsn, r] of eligFsn) {
    if (repFsns.has(fsn)) continue;
    const l = live(r.article_number);
    if (!l.ok) continue;
    if (l.basis !== "Stock only" && !l.sizes.includes(r.uk_size)) continue;
    if (repArts.has(r.article_number)) out.addSizes.push(mk("Add size", fsn, "Not in campaign", "Article already in the campaign; this size qualifies"));
    else out.newArticles.push(mk("Add new article", fsn, "Not in campaign", `${l.sizes.length} sizes ${l.basis === "Stock only" ? "in stock (not live-checked yet)" : "live on Flipkart"}`));
  }
  // articles to live-check: everything in the campaign + new candidates
  const arts = new Set([...repArts, ...eligible.articles]);
  for (const a of arts) {
    const rows = artFsns.get(a) ?? [];
    if (!rows.length) continue;
    const itemId = mode(rows.map((r) => r.item_id));
    out.articlesToCheck.push({ article: a, itemId, fsns: rows.filter((r) => r.item_id === itemId).sort((x, y) => y.q - x.q).map((r) => r.fsn).slice(0, 2) });
  }
  const byArt = (x: ActionRow, y: ActionRow) => x.article.localeCompare(y.article) || parseFloat(x.size) - parseFloat(y.size);
  (Object.keys(out) as (keyof Reconciled)[]).forEach((k) => { if (k !== "articlesToCheck") (out[k] as ActionRow[]).sort(byArt); });
  return out;
}

/** Keeps the pause register in step with what is really running in Flipkart. */
export function syncRegister(reg: Register, rep: CampaignReport, inv: InvRow[]): { next: Register; changed: number } {
  if (!rep.planner) return { next: reg, changed: 0 };
  const art = new Map(inv.map((r) => [r.fsn, r.article_number]));
  const state = new Map<string, { run: number; paused: number }>();
  for (const r of rep.rows) {
    const a = art.get(r.fsn); if (!a) continue;
    const e = state.get(a) ?? { run: 0, paused: 0 };
    if (r.status === "PAUSED") e.paused++; else e.run++;
    state.set(a, e);
  }
  const next = { ...reg }; let changed = 0;
  for (const [a, s] of state) {
    const k = regKey(rep.planner, a); const e = next[k];
    if (!e) continue;
    if (e.state === "To pause" && s.run === 0) { next[k] = { ...e, state: "Paused", pausedOn: rep.uploadedAt }; changed++; }
    else if (e.state === "Paused" && s.run > 0) { next[k] = { ...e, state: "Resumed", resumedOn: rep.uploadedAt }; changed++; }
  }
  return { next, changed };
}

export const actionSheet = (rows: ActionRow[]) => rows.map((r) => ({
  Action: r.action, Model: r.model, Article: r.article, Color: r.color, FSN: r.fsn, "UK size": r.size, QOH: r.qoh,
  "Status in campaign": r.status, "Live sizes": r.liveSizes, Basis: r.basis, Reason: r.reason,
  Clicks: r.clicks, "Ad spend": r.spend, Revenue: r.revenue, ROI: r.roi,
}));
