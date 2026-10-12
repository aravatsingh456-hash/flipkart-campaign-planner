import { api, type ArticleCheck, type CheckReq, type CheckRes } from "./api";
import type { InvRow } from "./processing";

/** Flipkart live check for a list of articles (same batching as the Live check page). */
export async function checkArticles(campaign: string, items: CheckReq[], inv: InvRow[], minLive: number, onProgress: (done: number) => void): Promise<ArticleCheck[]> {
  const info = new Map<string, InvRow>();
  for (const r of inv) if (!info.has(r.article_number)) info.set(r.article_number, r);
  const batches: CheckReq[][] = [];
  for (let i = 0; i < items.length; i += 4) batches.push(items.slice(i, i + 4));
  const one = async (b: CheckReq[]): Promise<CheckRes[]> => {
    try { return await api.check(b); } catch (e) {
      try { return await api.check(b); } catch { return b.map((r) => ({ article: r.article, ok: false, http: 0, error: String(e), sizes: [] })); }
    }
  };
  const out: ArticleCheck[] = [];
  let done = 0;
  for (let i = 0; i < batches.length; i += 2) {
    const grp = batches.slice(i, i + 2);
    const res = await Promise.all(grp.map(one));
    res.flat().forEach((r) => {
      const a = info.get(r.article);
      const live = [...new Set(r.sizes.filter((x) => x.inStock).map((x) => x.label))].sort((x, y) => parseFloat(x) - parseFloat(y));
      out.push({ campaign, article: r.article, model: a?.model_name ?? "", color: a?.color ?? "",
        status: !r.ok ? "Check failed" : live.length >= minLive ? "Active" : "Pause", liveSizes: live, http: r.http, error: r.error, oosFsns: [] });
    });
    done += grp.reduce((n, b) => n + b.length, 0); onProgress(done);
  }
  return out;
}
