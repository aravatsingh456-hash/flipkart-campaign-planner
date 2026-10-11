import { useMemo, useState } from "react";
import type { AppState } from "../App";
import type { OutRow, ProcessResult } from "../lib/processing";
import { api, type ArticleCheck, type CheckReq, type Run } from "../lib/api";
import { download, prefixOf, sheetsToXlsx } from "../lib/exports";

const BATCH = 4;      // articles per server call (keeps each call well under the 10s function limit)
const PARALLEL = 2;   // server calls in flight at once
const pickPref = ["8", "9", "7", "10", "6", "11", "5", "4", "3", "12"];

interface Art { campaign: string; article: string; model: string; color: string; itemId: string; rows: OutRow[] }

function mode(a: string[]) { const m = new Map<string, number>(); a.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1)); return [...m].sort((x, y) => y[1] - x[1])[0]?.[0] ?? ""; }

export function changesBetween(curr: Run, prev: Run | null) {
  const p = new Map((prev?.results ?? []).map((r) => [`${r.campaign}|${r.article}`, r]));
  const pause: ArticleCheck[] = []; const resume: ArticleCheck[] = [];
  for (const r of curr.results) {
    const o = p.get(`${r.campaign}|${r.article}`);
    if (r.status === "Pause" && (!o || o.status === "Active")) pause.push(r);
    if (r.status === "Active" && o?.status === "Pause") resume.push(r);
  }
  return { pause, resume };
}

export default function LiveCheckPage({ s, result }: { s: AppState; result: ProcessResult }) {
  const [scope, setScope] = useState("All campaigns");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");
  const [view, setView] = useState<{ run: Run; prev: Run | null } | null>(null);
  const minLive = s.config.settings.min_live_sizes;

  const arts = useMemo<Art[]>(() => {
    const out: Art[] = [];
    for (const c of result.campaigns) {
      if (scope !== "All campaigns" && c.campaign.name !== scope) continue;
      const by = new Map<string, OutRow[]>();
      c.rows.forEach((r) => { const a = by.get(r.article_number) ?? []; a.push(r); by.set(r.article_number, a); });
      for (const [article, rows] of by) out.push({
        campaign: c.campaign.name, article, rows, model: rows[0].model_name,
        color: mode(rows.map((r) => r.color)), itemId: mode(rows.map((r) => r.item_id)),
      });
    }
    return out;
  }, [result, scope]);

  async function runCheck() {
    if (!s.snapshot) return;
    setRunning(true); setErr(""); setDone(0); setTotal(arts.length);
    const prevId = s.runs[0]?.id;
    const results: ArticleCheck[] = [];
    try {
      const batches: Art[][] = [];
      for (let i = 0; i < arts.length; i += BATCH) batches.push(arts.slice(i, i + BATCH));
      const checkBatch = async (batch: Art[]) => {
        const req: CheckReq[] = batch.map((a) => ({
          article: a.article, itemId: a.itemId,
          fsns: [...a.rows].filter((r) => r.item_id === a.itemId).sort((x, y) => y.qoh - x.qoh).map((r) => r.fsn).slice(0, 2),
        }));
        try { return await api.check(req); }
        catch (e) {
          // one retry (e.g. function timeout), then mark as failed — never paused
          try { return await api.check(req); } catch { return req.map((r) => ({ article: r.article, ok: false, http: 0, error: String(e), sizes: [] })); }
        }
      };
      let finished = 0;
      for (let b = 0; b < batches.length; b += PARALLEL) {
        const group = batches.slice(b, b + PARALLEL);
        const resGroup = await Promise.all(group.map(checkBatch));
        group.forEach((batch, gi) => { const res = resGroup[gi]; batch.forEach((a, k) => {
          const r = res[k];
          if (!r.ok) { results.push({ campaign: a.campaign, article: a.article, model: a.model, color: a.color, status: "Check failed", liveSizes: [], http: r.http, error: r.error, oosFsns: [] }); return; }
          const live = [...new Set(r.sizes.filter((x) => x.inStock).map((x) => x.label))].sort((x, y) => parseFloat(x) - parseFloat(y));
          const liveSet = new Set(live);
          const oosFsns = a.rows.filter((x) => !liveSet.has(x.uk_size)).map((x) => x.fsn);
          const inStock = a.rows.filter((x) => liveSet.has(x.uk_size));
          const pick = pickPref.map((p) => inStock.find((x) => x.uk_size === p)).find(Boolean) ?? inStock[0];
          results.push({ campaign: a.campaign, article: a.article, model: a.model, color: a.color, status: live.length >= minLive ? "Active" : "Pause", liveSizes: live, http: r.http, inStockFsn: pick?.fsn, oosFsns });
        }); finished += batch.length; });
        setDone(finished);
      }
      const run: Run = {
        id: `${Date.now()}`, at: new Date().toISOString(), snapshotId: s.snapshot.id, scope,
        articles: results.length, failed: results.filter((r) => r.status === "Check failed").length, results,
      };
      // when checking one campaign, carry over other campaigns' last results so the latest run stays complete
      const prev = prevId ? await api.getRun(prevId).catch(() => null) : null;
      if (scope !== "All campaigns" && prev) run.results.push(...prev.results.filter((r) => r.campaign !== scope));
      await api.saveRun(run);
      s.addRun(run);
      setView({ run, prev });
    } catch (e) { setErr(String(e)); } finally { setRunning(false); }
  }

  const v = view ?? (s.latestRun ? { run: s.latestRun, prev: null } : null);
  const ch = view ? changesBetween(view.run, view.prev) : null;
  const camps = v ? [...new Set(v.run.results.map((r) => r.campaign))] : [];
  const failed = v?.run.results.filter((r) => r.status === "Check failed") ?? [];

  function report() {
    if (!v) return;
    const row = (r: ArticleCheck) => ({ Campaign: r.campaign, Model: r.model, Article: r.article, Color: r.color, Status: r.status, "Live sizes": r.liveSizes.join(", "), "No. of sizes": r.liveSizes.length, "In-stock FSN": r.inStockFsn ?? "", "OOS FSNs": r.oosFsns.join(" "), HTTP: r.http ?? "", Error: r.error ?? "" });
    download(`${prefixOf(s.config.settings.brand)}Live_Check_${v.run.at.slice(0, 16).replace(/[:T]/g, "-")}.xlsx`, sheetsToXlsx({
      ...(ch ? { "PAUSE NOW": ch.pause.map(row), "CAN RESUME": ch.resume.map(row) } : {}),
      "All articles": v.run.results.map(row),
    }), "application/octet-stream");
  }

  return (
    <>
      <div className="topbar"><h2>Live check</h2></div>
      <div className="card">
        <p className="muted">Checks each article's size availability on its Flipkart product page. Articles with fewer than <b>{minLive}</b> sizes in stock are marked Pause. Blocked/failed pages are marked "Check failed" and never paused.</p>
        <div className="row">
          <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={running}>
            <option>All campaigns</option>{result.campaigns.map((c) => <option key={c.campaign.name}>{c.campaign.name}</option>)}
          </select>
          <button className="btn" disabled={running || !arts.length} onClick={runCheck}>{running ? "Checking…" : `Run live stock check (${arts.length} articles)`}</button>
        </div>
        {running && <div style={{ marginTop: 12 }}><div className="progress"><div style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div><p className="muted">{done} / {total} articles</p></div>}
        {err && <div className="alert bad" style={{ marginTop: 12 }}>{err}</div>}
      </div>

      {v && (
        <>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <span className="muted">Showing check from {new Date(v.run.at).toLocaleString("en-IN")} · {v.run.scope}</span>
            <button className="btn ghost" onClick={report}>Download status report (Excel)</button>
          </div>
          {failed.length > 0 && <div className="alert warn">{failed.length} article(s) could not be checked (e.g. HTTP {[...new Set(failed.map((f) => f.http || "error"))].join(", ")}). They were NOT paused.</div>}
          <div className="grid" style={{ marginBottom: 16 }}>
            {camps.map((c) => {
              const rs = v.run.results.filter((r) => r.campaign === c);
              return (
                <div className="stat" key={c}><div style={{ fontWeight: 600 }}>{c}</div>
                  <div className="row" style={{ marginTop: 6, gap: 6 }}>
                    <span className="pill ok">Active {rs.filter((r) => r.status === "Active").length}</span>
                    <span className="pill bad">Pause {rs.filter((r) => r.status === "Pause").length}</span>
                    {rs.some((r) => r.status === "Check failed") && <span className="pill warn">Failed {rs.filter((r) => r.status === "Check failed").length}</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>OOS FSNs: {rs.reduce((n, r) => n + r.oosFsns.length, 0)}</div>
                </div>
              );
            })}
          </div>
          {ch && (
            <div className="card">
              <h3>Changes since last check</h3>
              {!ch.pause.length && !ch.resume.length && <p className="muted">No changes.</p>}
              {[["PAUSE NOW", ch.pause, "bad"], ["CAN RESUME", ch.resume, "ok"]].map(([label, list, cls]) => (list as ArticleCheck[]).length > 0 && (
                <div key={label as string} style={{ marginBottom: 14 }}>
                  <p><span className={`pill ${cls}`}>{label as string}</span> {(list as ArticleCheck[]).length}</p>
                  <table><thead><tr><th>Campaign</th><th>Model</th><th>Article</th><th>Color</th><th>Live sizes</th><th>In-stock FSN</th></tr></thead>
                    <tbody>{(list as ArticleCheck[]).map((r) => <tr key={r.campaign + r.article}><td>{r.campaign}</td><td>{r.model}</td><td>{r.article}</td><td>{r.color}</td><td>{r.liveSizes.join(", ") || "None"}</td><td>{r.inStockFsn ?? "—"}</td></tr>)}</tbody></table>
                </div>
              ))}
              {!view?.prev && <p className="muted">This is the first check — every article below the threshold is listed under PAUSE NOW.</p>}
            </div>
          )}
          <div className="card">
            <h3>All articles</h3>
            <div className="tablewrap" style={{ maxHeight: 500 }}>
              <table><thead><tr><th>Campaign</th><th>Model</th><th>Article</th><th>Color</th><th>Status</th><th>Live sizes</th><th className="num">OOS FSNs</th></tr></thead>
                <tbody>{v.run.results.map((r) => (
                  <tr key={r.campaign + r.article}><td>{r.campaign}</td><td>{r.model}</td><td>{r.article}</td><td>{r.color}</td>
                    <td>{r.status === "Active" ? <span className="pill ok">Active</span> : r.status === "Pause" ? <span className="pill bad">Pause</span> : <span className="pill warn" title={r.error}>Check failed {r.http ? `(${r.http})` : ""}</span>}</td>
                    <td>{r.liveSizes.join(", ") || (r.status === "Check failed" ? "—" : "None")}</td><td className="num">{r.oosFsns.length}</td></tr>
                ))}</tbody></table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
