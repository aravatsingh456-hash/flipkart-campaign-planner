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

  async function clear(what: "uploads" | "runs" | "settings" | "all", id?: string, label?: string) {
    const msg = id ? `Delete this ${label}? This cannot be undone.`
      : { uploads: "Delete ALL uploads?", runs: "Delete ALL live check history and the pause register (all pause/resume dates)?", settings: "Reset settings and campaigns to defaults?", all: "Delete EVERYTHING (uploads, live checks and settings)?" }[what] + " This cannot be undone.";
    if (!window.confirm(msg)) return;
    setBusy(`clear-${what}-${id ?? ""}`);
    try { await api.clear(what, id); window.location.reload(); }
    catch (e) { window.alert(`Could not delete: ${String(e)}`); setBusy(""); }
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
                <button className="btn small danger" disabled={!!busy} onClick={() => clear("uploads", m.id, "upload")}>Delete</button>
              </td></tr>
          ))}</tbody></table>
        {!s.snapshots.length && <p className="muted">No uploads yet.</p>}
      </div>
      <div className="card">
        <h3>Live check runs</h3>
        <table><thead><tr><th>Run at</th><th>Scope</th><th className="num">Articles</th><th className="num">Failed</th><th></th></tr></thead>
          <tbody>{s.runs.map((r) => (
            <tr key={r.id}><td>{new Date(r.at).toLocaleString("en-IN")}</td><td>{r.scope}</td><td className="num">{r.articles}</td><td className="num">{r.failed}</td>
              <td style={{ textAlign: "right" }}><button className="btn small danger" disabled={!!busy} onClick={() => clear("runs", r.id, "live check")}>Delete</button></td></tr>
          ))}</tbody></table>
        {!s.runs.length && <p className="muted">No checks yet.</p>}
      </div>
      <div className="card">
        <h3>Clear data</h3>
        <p className="muted">Use this to start fresh (for example, before a new sale or a new client). Deleted data cannot be recovered.</p>
        <div className="row">
          <button className="btn small danger" disabled={!!busy} onClick={() => clear("runs")}>Clear live check history & pause register</button>
          <button className="btn small danger" disabled={!!busy} onClick={() => clear("uploads")}>Clear all uploads</button>
          <button className="btn small danger" disabled={!!busy} onClick={() => clear("settings")}>Reset settings to defaults</button>
          <button className="btn danger" disabled={!!busy} onClick={() => clear("all")}>Clear everything</button>
        </div>
      </div>
    </>
  );
}
