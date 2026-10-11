import type { Campaign, Settings } from "./defaults";

/** Compact inventory row: [fsn, item_id, article, model, color, mrp, vertical, super_category, uk_size, size, qoh] */
export type InvTuple = [string, string, string, string, string, number, string, string, string, string, number];

export interface InvRow {
  fsn: string; item_id: string; article_number: string; model_name: string; color: string;
  mrp: number; vertical: string; super_category: string; uk_size: string; size: string; qoh: number;
}
export const fromTuple = (t: InvTuple): InvRow => ({
  fsn: t[0], item_id: t[1], article_number: t[2], model_name: t[3], color: t[4], mrp: t[5],
  vertical: t[6], super_category: t[7], uk_size: t[8], size: t[9], qoh: t[10],
});

export interface OutRow {
  campaign: string; model_name: string; article_number: string; fsn: string; item_id: string;
  color: string; mrp: number; qoh: number; uk_size: string; size: string; vertical: string; core: string;
}
export interface CampaignResult { campaign: Campaign; rows: OutRow[]; articles: string[]; totalQoh: number }
export interface ProcessResult { campaigns: CampaignResult[]; warnings: string[] }

/** 7.0 -> "7", 7.50 -> "7.5", "UK 8" -> "8" */
export function normSize(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  const m = s.match(/\d+(\.\d+)?/);
  if (!m) return s;
  return String(parseFloat(m[0]));
}

export function processInventory(rows: InvRow[], campaigns: Campaign[], s: Settings): ProcessResult {
  const warnings: string[] = [];
  const fsnOwner = new Map<string, string>();
  const results: CampaignResult[] = [];
  for (const camp of campaigns) {
    if (!camp.active) continue;
    const out: OutRow[] = [];
    const core = camp.gender === "Women" ? s.core_women : s.core_men;
    for (const rule of camp.rules) {
      const sub = rows.filter((r) => r.vertical === rule.vertical && r.mrp >= rule.mrp_from && r.mrp <= rule.mrp_to);
      const sizeQoh = new Map<string, Map<string, number>>();
      for (const r of sub) {
        let m = sizeQoh.get(r.article_number);
        if (!m) sizeQoh.set(r.article_number, (m = new Map()));
        m.set(r.size, (m.get(r.size) ?? 0) + (r.qoh || 0));
      }
      const qualifying = new Map<string, Set<string>>();
      for (const [art, m] of sizeQoh) {
        const q = new Set([...m].filter(([, v]) => v >= s.min_qoh).map(([k]) => k));
        if (q.size >= s.min_sizes_select) qualifying.set(art, q);
      }
      const fsnAgg = new Map<string, { row: InvRow; qoh: number }>();
      for (const r of sub) {
        const q = qualifying.get(r.article_number);
        if (!q || !q.has(r.size)) continue;
        const a = fsnAgg.get(r.fsn);
        if (a) a.qoh += r.qoh || 0;
        else fsnAgg.set(r.fsn, { row: r, qoh: r.qoh || 0 });
      }
      const coreByArt = new Map<string, Set<string>>();
      for (const { row, qoh } of fsnAgg.values()) {
        if (qoh <= 0) continue;
        const u = normSize(row.uk_size);
        if (core.includes(u)) {
          let set = coreByArt.get(row.article_number);
          if (!set) coreByArt.set(row.article_number, (set = new Set()));
          set.add(u);
        }
      }
      for (const { row, qoh } of fsnAgg.values()) {
        if (qoh <= 0) continue;
        const owner = fsnOwner.get(row.fsn);
        if (owner) {
          if (owner !== camp.name) warnings.push(`FSN ${row.fsn} (${row.article_number}) matches "${owner}" and "${camp.name}" — kept in "${owner}".`);
          continue;
        }
        fsnOwner.set(row.fsn, camp.name);
        const cs = core.filter((c) => coreByArt.get(row.article_number)?.has(c));
        out.push({
          campaign: camp.name, model_name: row.model_name, article_number: row.article_number, fsn: row.fsn,
          item_id: row.item_id, color: row.color, mrp: row.mrp, qoh, uk_size: normSize(row.uk_size),
          size: row.size, vertical: row.vertical,
          core: `${cs.length ? cs.join(", ") : "None"} (${cs.length}/${core.length})`,
        });
      }
    }
    const artQoh = new Map<string, number>();
    for (const r of out) artQoh.set(r.article_number, (artQoh.get(r.article_number) ?? 0) + r.qoh);
    out.sort((a, b) => (artQoh.get(b.article_number)! - artQoh.get(a.article_number)!) ||
      a.article_number.localeCompare(b.article_number) || parseFloat(a.uk_size) - parseFloat(b.uk_size));
    results.push({ campaign: camp, rows: out, articles: [...new Set(out.map((r) => r.article_number))], totalQoh: out.reduce((n, r) => n + r.qoh, 0) });
  }
  return { campaigns: results, warnings };
}

/** QOH by MRP point for each vertical (helper for choosing splits). */
export function mrpTable(rows: InvRow[]) {
  const t = new Map<string, Map<number, number>>();
  for (const r of rows) {
    let m = t.get(r.vertical);
    if (!m) t.set(r.vertical, (m = new Map()));
    m.set(r.mrp, (m.get(r.mrp) ?? 0) + r.qoh);
  }
  return [...t].map(([vertical, m]) => ({
    vertical,
    total: [...m.values()].reduce((a, b) => a + b, 0),
    points: [...m].sort((a, b) => a[0] - b[0]),
  })).sort((a, b) => b.total - a.total);
}
