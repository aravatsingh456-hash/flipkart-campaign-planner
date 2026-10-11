import { useMemo, useState } from "react";
import type { AppState } from "../App";
import type { ProcessResult } from "../lib/processing";

export default function CampaignsPage({ s, result }: { s: AppState; result: ProcessResult }) {
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("All");
  const run = s.latestRun;
  const checks = useMemo(() => new Map((run?.results ?? []).map((r) => [`${r.campaign}|${r.article}`, r])), [run]);

  if (!s.snapshot) return (
    <div className="card" style={{ textAlign: "center", padding: 40 }}>
      <h3>No inventory yet</h3><p className="muted">Upload the client's QOH Excel to build campaigns.</p>
      <button className="btn" onClick={() => s.go("upload")}>Upload inventory</button>
    </div>
  );

  const c = result.campaigns[Math.min(tab, result.campaigns.length - 1)];
  const rows = (c?.rows ?? []).filter((r) => {
    const ch = checks.get(`${r.campaign}|${r.article_number}`);
    const st = ch ? (ch.status === "Active" ? "Active" : ch.status === "Pause" ? "Paused" : "Check failed") : "Not checked";
    if (status !== "All" && st !== status) return false;
    const t = q.trim().toLowerCase();
    return !t || [r.model_name, r.article_number, r.fsn, r.color].some((x) => x.toLowerCase().includes(t));
  });
  let prev = ""; let alt = false;

  return (
    <>
      <div className="topbar"><h2>Campaigns</h2>
        <span className="muted">{run ? `Last live check: ${new Date(run.at).toLocaleString("en-IN")}` : "No live check yet"}</span>
      </div>
      <div className="tabs">{result.campaigns.map((x, i) => (
        <button key={x.campaign.name} className={i === tab ? "on" : ""} onClick={() => setTab(i)}>{x.campaign.name} · {x.articles.length}</button>
      ))}</div>
      {c && (
        <div className="grid" style={{ marginBottom: 14 }}>
          <div className="stat">Articles<b>{c.articles.length}</b></div>
          <div className="stat">FSNs<b>{c.rows.length}</b></div>
          <div className="stat">QOH (upload)<b>{c.totalQoh.toLocaleString("en-IN")}</b></div>
          <div className="stat">Rules<div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{c.campaign.rules.map((r) => `${r.vertical} ₹${r.mrp_from}–${r.mrp_to}`).join(" · ")}</div></div>
        </div>
      )}
      <div className="row" style={{ marginBottom: 10 }}>
        <input placeholder="Search model, article, FSN, color" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 280 }} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>{["All", "Active", "Paused", "Check failed", "Not checked"].map((x) => <option key={x}>{x}</option>)}</select>
        <span className="muted">{rows.length} rows</span>
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Model</th><th>Article</th><th>FSN</th><th>Color</th><th className="num">MRP</th><th className="num">QOH</th><th>UK size</th><th>Vertical</th><th>Core sizes</th><th>Status</th><th>Live sizes</th></tr></thead>
          <tbody>{rows.map((r) => {
            if (r.article_number !== prev) { alt = !alt; prev = r.article_number; }
            const ch = checks.get(`${r.campaign}|${r.article_number}`);
            const oos = ch?.oosFsns.includes(r.fsn);
            return (
              <tr key={r.fsn} className={alt ? "alt" : ""}>
                <td>{r.model_name}</td><td>{r.article_number}</td><td>{r.fsn}</td><td>{r.color}</td>
                <td className="num">₹{r.mrp.toLocaleString("en-IN")}</td><td className="num">{r.qoh}</td><td>{r.uk_size}</td><td>{r.vertical}</td><td>{r.core}</td>
                <td>{!ch ? <span className="pill grey">Not checked</span> : ch.status === "Active" ? <span className="pill ok">Active</span> : ch.status === "Pause" ? <span className="pill bad">Paused</span> : <span className="pill warn">Check failed</span>}
                  {oos && <span className="pill bad" style={{ marginLeft: 4 }}>OOS</span>}</td>
                <td>{ch?.status === "Check failed" ? "—" : ch?.liveSizes.join(", ")}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {result.warnings.length > 0 && <div className="alert warn" style={{ marginTop: 12 }}>{result.warnings.length} FSN(s) matched two campaigns and were kept in the first one (see Settings → campaign order).</div>}
    </>
  );
}
