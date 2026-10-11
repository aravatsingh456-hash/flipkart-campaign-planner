import { useState } from "react";
import * as XLSX from "xlsx";
import type { AppState } from "../App";
import { REQUIRED_COLUMNS } from "../lib/defaults";
import { fromTuple, normSize, processInventory, type InvTuple } from "../lib/processing";
import { api } from "../lib/api";
import { buildCsvFiles, buildWorkbook, buildZip, download, prefixOf } from "../lib/exports";

const str = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export default function UploadPage({ s }: { s: AppState }) {
  const [wb, setWb] = useState<XLSX.WorkBook | null>(null);
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onFile(f: File) {
    setErr(""); setDone(false);
    const book = XLSX.read(await f.arrayBuffer(), { type: "array" });
    setWb(book); setFileName(f.name);
    const qoh = book.SheetNames.find((n) => n.trim().toLowerCase() === "qoh");
    if (qoh) await processSheet(book, qoh, f.name);
    else setSheet("");
  }

  async function processSheet(book: XLSX.WorkBook, name: string, fname: string) {
    setSheet(name); setErr("");
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[name], { defval: null });
    const cols = Object.keys(data[0] ?? {});
    const missing = REQUIRED_COLUMNS.filter((c) => !cols.includes(c));
    if (missing.length) { setErr(`Missing columns in sheet "${name}": ${missing.join(", ")}`); return; }
    const tuples: InvTuple[] = data
      .filter((r) => str(r.inv_fsn) && str(r.article_number))
      .map((r) => [
        str(r.inv_fsn), str(r.item_id), str(r.article_number), str(r.model_name), str(r.color), num(r.mrp_amount),
        str(r.inv_vertical), str(r.inv_super_category), normSize(r.uk_india_size), normSize(r.final_size_fw), num(r.qoh),
      ]);
    setBusy(true);
    try {
      const meta = { id: `${Date.now()}`, fileName: fname, uploadedAt: new Date().toISOString(), rowCount: tuples.length };
      await api.saveSnapshot(meta, tuples);
      s.addSnapshot(meta, tuples.map(fromTuple));
      setDone(true);
    } catch (e) {
      setErr(`Saving failed: ${String(e)}`);
    } finally { setBusy(false); }
  }

  const px = prefixOf(s.config.settings.brand);
  const result = processInventory(s.rows, s.config.campaigns, s.config.settings);
  const meta = s.snapshot ? `Source: ${s.snapshot.fileName} · rules: size QOH ≥ ${s.config.settings.min_qoh}, ≥ ${s.config.settings.min_sizes_select} sizes per article` : "";

  return (
    <>
      <div className="topbar"><h2>Upload inventory</h2></div>
      <div className="card">
        <div className="drop">
          <p><b>Upload the client's QOH Excel (.xlsx)</b></p>
          <p className="muted">The sheet named "QOH" is read automatically. Required columns: {REQUIRED_COLUMNS.join(", ")}</p>
          <input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </div>
        {wb && !sheet && (
          <div className="row" style={{ marginTop: 12 }}>
            <span>No "QOH" sheet found. Pick a sheet:</span>
            <select onChange={(e) => e.target.value && processSheet(wb, e.target.value, fileName)} defaultValue="">
              <option value="">Select…</option>
              {wb.SheetNames.map((n) => <option key={n}>{n}</option>)}
            </select>
          </div>
        )}
        {busy && <p className="muted">Processing and saving…</p>}
        {err && <div className="alert bad" style={{ marginTop: 12 }}>{err}</div>}
      </div>

      {done && (
        <div className="card">
          <h3>Campaign creation files</h3>
          <p className="muted">Download these once to create campaigns in Flipkart Ads. Live checks later will not regenerate them.</p>
          {result.warnings.length > 0 && <div className="alert warn">{result.warnings.length} FSN(s) matched two campaigns and were kept in the first one.</div>}
          <div className="row" style={{ marginBottom: 14 }}>
            <button className="btn" onClick={() => download(`${px}Campaign_Product_List.xlsx`, buildWorkbook(result.campaigns, meta), "application/octet-stream")}>Download Excel (all campaigns)</button>
            <button className="btn ghost" onClick={async () => download(`${px}Flipkart_Upload_CSVs.zip`, await buildZip(px, result.campaigns), "application/zip")}>Download all CSVs (ZIP)</button>
          </div>
          <table>
            <thead><tr><th>Campaign</th><th className="num">Articles</th><th className="num">FSNs</th><th className="num">QOH</th><th>Flipkart upload CSV</th></tr></thead>
            <tbody>
              {result.campaigns.map((c) => (
                <tr key={c.campaign.name}>
                  <td>{c.campaign.name}</td><td className="num">{c.articles.length}</td><td className="num">{c.rows.length}</td>
                  <td className="num">{c.totalQoh.toLocaleString("en-IN")}</td>
                  <td>{buildCsvFiles(px, c.campaign.name, c.rows.map((r) => r.fsn)).map((f) => (
                    <button key={f.name} className="btn small ghost" style={{ marginRight: 6 }} disabled={!c.rows.length} onClick={() => download(f.name, f.content)}>{f.name}</button>
                  ))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 14 }}><button className="btn ghost" onClick={() => s.go("campaigns")}>View campaigns</button></div>
        </div>
      )}
    </>
  );
}
