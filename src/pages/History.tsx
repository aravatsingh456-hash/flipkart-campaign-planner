import { useState } from "react";
import type { AppState } from "../App";
import { fromTuple, processInventory } from "../lib/processing";
import { api } from "../lib/api";
import { buildWorkbook, buildZip, download, prefixOf } from "../lib/exports";

export default function HistoryPage({ s }: { s: AppState }) {
  const [busy, setBusy] = useState("");

  async function files(id: string) {
    setBusy(id);
    try {
      const snap = await api.getSnapshot(id);
      const res = processInventory(snap.rows.map(fromTuple), s.config.campaigns, s.config.settings);
      const px = prefixOf(s.config.settings.brand);
      download(`${px}Campaign_Product_List.xlsx`, buildWorkbook(res.campaigns, `Source: ${snap.meta.fileName}`), "application/octet-stream");
      download(`${px}Flipkart_Upload_CSVs.zip`, await buildZip(px, res.campaigns), "application/zip");
    } finally { setBusy(""); }
  }

  return (
    <>
      <div className="topbar"><h2>History</h2></div>
      <div className="card">
        <h3>Uploads</h3>
        <table><thead><tr><th>Uploaded</th><th>File</th><th className="num">Rows</th><th></th></tr></thead>
          <tbody>{s.snapshots.map((m) => (
            <tr key={m.id}><td>{new Date(m.uploadedAt).toLocaleString("en-IN")}</td><td>{m.fileName}</td><td className="num">{m.rowCount}</td>
              <td className="row" style={{ justifyContent: "flex-end" }}>
                {s.snapshot?.id === m.id ? <span className="pill ok">Current base</span> : <button className="btn small ghost" onClick={() => s.useSnapshot(m.id)}>Use as base</button>}
                <button className="btn small ghost" disabled={busy === m.id} onClick={() => files(m.id)}>{busy === m.id ? "Preparing…" : "Campaign files"}</button>
              </td></tr>
          ))}</tbody></table>
        {!s.snapshots.length && <p className="muted">No uploads yet.</p>}
      </div>
      <div className="card">
        <h3>Live check runs</h3>
        <table><thead><tr><th>Run at</th><th>Scope</th><th className="num">Articles</th><th className="num">Failed</th></tr></thead>
          <tbody>{s.runs.map((r) => (
            <tr key={r.id}><td>{new Date(r.at).toLocaleString("en-IN")}</td><td>{r.scope}</td><td className="num">{r.articles}</td><td className="num">{r.failed}</td></tr>
          ))}</tbody></table>
        {!s.runs.length && <p className="muted">No checks yet.</p>}
      </div>
    </>
  );
}
