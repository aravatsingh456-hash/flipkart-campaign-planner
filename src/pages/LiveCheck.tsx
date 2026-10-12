import { useMemo, useState } from "react";
import type { AppState } from "../App";
import type { OutRow, ProcessResult } from "../lib/processing";
import { api, type ArticleCheck, type CheckReq, type Run } from "../lib/api";
import { download, prefixOf, sheetsToXlsx } from "../lib/exports";
import { applyRun, canResume, fmtDate, paused, regKey, toPause, type RegEntry, type Register } from "../lib/register";

const BATCH = 4;      // articles per server call (keeps each call well under the 10s function limit)
const PARALLEL = 2;   // server calls in flight at once
const pickPref = ["8", "9", "7", "10", "6", "11", "5", "4", "3", "12"];

interface Art { campaign: string; article: string; model: string; color: string; itemId: string; rows: OutRow[] }

function mode(a: string[]) { const m = new Map<string, number>(); a.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1)); return [...m].sort((x, y) => y[1] - x[1])[0]?.[0] ?? ""; }

export default function LiveCheckPage({ s, result }: { s: AppState; result: ProcessResult }) {
  const [scope, setScope] = useState("All campaigns");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");
  const [view, setView] = useState<Run | null>(null);
  const [regTab, setRegTab] = useState<"pause" | "resume" | "paused">("pause");
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
    // the same article can sit in several campaigns: check each article once, then apply to every campaign
    const byArt = new Map<string, Art[]>();
    arts.forEach((a) => { const l = byArt.get(a.article) ?? []; l.push(a); byArt.set(a.article, l); });
    const uniq = [...byArt.values()].map((l) => l[0]);
    setRunning(true); setErr(""); setDone(0); setTotal(uniq.length);
    const prevId = s.runs[0]?.id;
    const results: ArticleCheck[] = [];
    try {
      const batches: Art[][] = [];
      for (let i = 0; i < uniq.length; i += BATCH) batches.push(uniq.slice(i, i + BATCH));
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
        group.forEach((batch, gi) => { const res = resGroup[gi]; batch.flatMap((u, k) => (byArt.get(u.article) ?? [u]).map((a) => [a, k] as const)).forEach(([a, k]) => {
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
      if (scope !== "All campaigns" && prev) { const names = new Set(s.config.campaigns.map((c) => c.name)); run.results.push(...prev.results.filter((r) => r.campaign !== scope && names.has(r.campaign))); }
      await api.saveRun(run);
      s.addRun(run);
      await s.setRegister(applyRun(s.register, run, scope === "All campaigns" ? null : new Set([scope])));
      setView(run);
      setRegTab("pause");
    } catch (e) { setErr(String(e)); } finally { setRunning(false); }
  }

  const run = view ?? s.latestRun;
  const camps = run ? [...new Set(run.results.map((r) => r.campaign))] : [];
  const failed = run?.results.filter((r) => r.status === "Check failed") ?? [];
  const reg = s.register;
  const listToPause = toPause(reg).sort((a, b) => a.campaign.localeCompare(b.campaign) || a.article.localeCompare(b.article));
  const listResume = canResume(reg).sort((a, b) => a.campaign.localeCompare(b.campaign) || a.article.localeCompare(b.article));
  const listPaused = paused(reg).sort((a, b) => a.campaign.localeCompare(b.campaign) || a.article.localeCompare(b.article));
  const px = prefixOf(s.config.settings.brand);
  const today = new Date().toISOString().slice(0, 10);

  // all FSNs of an article in its campaign (from the current inventory base)
  const fsnsOf = useMemo(() => {
    const m = new Map<string, OutRow[]>();
    for (const c of result.campaigns) for (const r of c.rows) {
      const k = regKey(c.campaign.name, r.article_number);
      const a = m.get(k) ?? []; a.push(r); m.set(k, a);
    }
    return m;
  }, [result]);

  const fsnRows = (list: RegEntry[], dateCol: string, dateOf: (e: RegEntry) => string | undefined) =>
    list.flatMap((e) => (fsnsOf.get(regKey(e.campaign, e.article)) ?? [{ fsn: "(not in current upload)", uk_size: "" } as OutRow]).map((r) => ({
      [dateCol]: fmtDate(dateOf(e)), Campaign: e.campaign, Model: e.model, Article: e.article, Color: e.color,
      FSN: r.fsn, "UK size": r.uk_size, "Live sizes on Flipkart": e.liveSizes.join(", ") || "None", "No. of live sizes": e.liveSizes.length,
      "Last checked": fmtDate(e.lastCheckedAt),
    })));
  const regRow = (e: RegEntry) => ({
    Campaign: e.campaign, Model: e.model, Article: e.article, Color: e.color, State: e.state,
    "Pause flagged on": fmtDate(e.flaggedOn), "Paused in Flipkart on": fmtDate(e.pausedOn), "Resumed on": fmtDate(e.resumedOn),
    "Live sizes (last check)": e.liveSizes.join(", ") || "None", "Last checked": fmtDate(e.lastCheckedAt),
  });

  function downloadPause() {
    download(`${px}FSNs_to_Pause_${today}.xlsx`, sheetsToXlsx({
      "FSNs to pause": fsnRows(listToPause, "Pause flagged on", (e) => e.flaggedOn),
      "Articles to pause": listToPause.map(regRow),
      "Already paused": listPaused.map(regRow),
    }), "application/octet-stream");
  }
  function downloadResume() {
    download(`${px}FSNs_to_Resume_${today}.xlsx`, sheetsToXlsx({
      "FSNs to resume": fsnRows(listResume, "Paused in Flipkart on", (e) => e.pausedOn),
      "Articles to resume": listResume.map(regRow),
    }), "application/octet-stream");
  }
  async function mark(list: RegEntry[], state: "Paused" | "Resumed") {
    const label = state === "Paused" ? "paused in Flipkart Ads" : "switched back ON in Flipkart Ads";
    if (!window.confirm(`Confirm ${list.length} article(s) are now ${label}? Today's date will be saved.`)) return;
    const now = new Date().toISOString();
    const next: Register = { ...reg };
    for (const e of list) {
      const k = regKey(e.campaign, e.article);
      next[k] = state === "Paused" ? { ...next[k], state, pausedOn: now } : { ...next[k], state, resumedOn: now };
    }
    await s.setRegister(next);
  }
  function report() {
    if (!run) return;
    const row = (r: ArticleCheck) => ({ Campaign: r.campaign, Model: r.model, Article: r.article, Color: r.color, Status: r.status, "Live sizes": r.liveSizes.join(", "), "No. of sizes": r.liveSizes.length, "In-stock FSN": r.inStockFsn ?? "", "OOS FSNs": r.oosFsns.join(" "), HTTP: r.http ?? "", Error: r.error ?? "" });
    download(`${px}Live_Check_${run.at.slice(0, 16).replace(/[:T]/g, "-")}.xlsx`, sheetsToXlsx({
      "All articles": run.results.map(row), "Pause register": Object.values(reg).map(regRow),
    }), "application/octet-stream");
  }

  const regTable = (list: RegEntry[], kind: "pause" | "resume" | "paused") => (
    <div className="tablewrap" style={{ maxHeight: 420 }}>
      <table><thead><tr><th>Campaign</th><th>Model</th><th>Article</th><th>Color</th><th>Live sizes</th>
        <th>{kind === "pause" ? "Pause flagged on" : "Paused on"}</th>{kind !== "pause" && <th>Flagged on</th>}<th className="num">FSNs</th><th></th></tr></thead>
        <tbody>{list.map((e) => (
          <tr key={e.campaign + e.article}><td>{e.campaign}</td><td>{e.model}</td><td>{e.article}</td><td>{e.color}</td>
            <td>{e.liveSizes.join(", ") || "None"}</td>
            <td>{fmtDate(kind === "pause" ? e.flaggedOn : e.pausedOn)}</td>{kind !== "pause" && <td>{fmtDate(e.flaggedOn)}</td>}
            <td className="num">{fsnsOf.get(regKey(e.campaign, e.article))?.length ?? 0}</td>
            <td style={{ textAlign: "right" }}>
              {kind === "pause" && <button className="btn small ghost" onClick={() => mark([e], "Paused")}>Mark paused</button>}
              {kind === "resume" && <button className="btn small ghost" onClick={() => mark([e], "Resumed")}>Mark resumed</button>}
            </td></tr>
        ))}</tbody></table>
      {!list.length && <p className="muted" style={{ padding: 10 }}>Nothing here.</p>}
    </div>
  );

  return (
    <>
      <div className="topbar"><h2>Live check</h2></div>
      <div className="card">
        <p className="muted">Checks each article's size availability on its Flipkart product page. Articles with fewer than <b>{minLive}</b> sizes in stock are marked Pause. Blocked/failed pages are marked "Check failed" and never paused.</p>
        <div className="row">
          <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={running}>
            <option>All campaigns</option>{result.campaigns.map((c) => <option key={c.campaign.name}>{c.campaign.name}</option>)}
          </select>
          <button className="btn" disabled={running || !arts.length} onClick={runCheck}>{running ? "Checking…" : `Run live stock check (${new Set(arts.map((a) => a.article)).size} articles)`}</button>
        </div>
        {running && <div style={{ marginTop: 12 }}><div className="progress"><div style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div><p className="muted">{done} / {total} articles</p></div>}
        {err && <div className="alert bad" style={{ marginTop: 12 }}>{err}</div>}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Pause register</h3>
          <span className="muted" style={{ fontSize: 13 }}>Remembers when each article was flagged, paused and resumed.</span>
        </div>
        <div className="tabs" style={{ marginTop: 12 }}>
          <button className={regTab === "pause" ? "on" : ""} onClick={() => setRegTab("pause")}>To pause · {listToPause.length}</button>
          <button className={regTab === "resume" ? "on" : ""} onClick={() => setRegTab("resume")}>Can resume · {listResume.length}</button>
          <button className={regTab === "paused" ? "on" : ""} onClick={() => setRegTab("paused")}>Currently paused · {listPaused.length}</button>
        </div>
        {regTab === "pause" && (<>
          <p className="muted">These articles have fewer than {minLive} sizes in stock on Flipkart. Download the FSN list, pause all of them in Flipkart Ads, then click <b>Mark all as paused</b> so the app records today's date.</p>
          <div className="row" style={{ marginBottom: 10 }}>
            <button className="btn" disabled={!listToPause.length} onClick={downloadPause}>Download FSNs to pause (Excel)</button>
            <button className="btn ghost" disabled={!listToPause.length} onClick={() => mark(listToPause, "Paused")}>Mark all as paused</button>
          </div>
          {regTable(listToPause, "pause")}
        </>)}
        {regTab === "resume" && (<>
          <p className="muted">These articles were paused but now have {minLive}+ sizes in stock again. Switch them back on in Flipkart Ads, then click <b>Mark all as resumed</b>.</p>
          <div className="row" style={{ marginBottom: 10 }}>
            <button className="btn" disabled={!listResume.length} onClick={downloadResume}>Download FSNs to resume (Excel)</button>
            <button className="btn ghost" disabled={!listResume.length} onClick={() => mark(listResume, "Resumed")}>Mark all as resumed</button>
          </div>
          {regTable(listResume, "resume")}
        </>)}
        {regTab === "paused" && regTable(listPaused, "paused")}
      </div>

      {run && (
        <>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <span className="muted">Last check: {new Date(run.at).toLocaleString("en-IN")} · {run.scope}</span>
            <button className="btn ghost" onClick={report}>Download full status report (Excel)</button>
          </div>
          {failed.length > 0 && <div className="alert warn">{failed.length} article(s) could not be checked (e.g. HTTP {[...new Set(failed.map((f) => f.http || "error"))].join(", ")}). They were NOT flagged for pause.</div>}
          <div className="grid" style={{ marginBottom: 16 }}>
            {camps.map((c) => {
              const rs = run.results.filter((r) => r.campaign === c);
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
          <div className="card">
            <h3>All articles (last check)</h3>
            <div className="tablewrap" style={{ maxHeight: 500 }}>
              <table><thead><tr><th>Campaign</th><th>Model</th><th>Article</th><th>Color</th><th>Status</th><th>Live sizes</th><th className="num">OOS FSNs</th><th>Register</th></tr></thead>
                <tbody>{run.results.map((r) => { const e = reg[regKey(r.campaign, r.article)]; return (
                  <tr key={r.campaign + r.article}><td>{r.campaign}</td><td>{r.model}</td><td>{r.article}</td><td>{r.color}</td>
                    <td>{r.status === "Active" ? <span className="pill ok">Active</span> : r.status === "Pause" ? <span className="pill bad">Pause</span> : <span className="pill warn" title={r.error}>Check failed {r.http ? `(${r.http})` : ""}</span>}</td>
                    <td>{r.liveSizes.join(", ") || (r.status === "Check failed" ? "—" : "None")}</td><td className="num">{r.oosFsns.length}</td>
                    <td>{e && e.state !== "Resumed" ? `${e.state} · ${fmtDate(e.state === "Paused" ? e.pausedOn : e.flaggedOn)}` : ""}</td></tr>
                ); })}</tbody></table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
