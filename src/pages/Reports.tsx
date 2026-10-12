import { useEffect, useMemo, useState } from "react";
import type { AppState } from "../App";
import { api } from "../lib/api";
import { checkArticles } from "../lib/checker";
import { buildCsvFiles, download, prefixOf, safeName, sheetsToXlsx } from "../lib/exports";
import { actionSheet, metaOf, parseReport, reconcile, rulesFrom, suggestCampaign, syncRegister, type ActionRow, type CampaignReport, type Reconciled, type ReportMeta } from "../lib/reports";

const XL = "application/octet-stream";
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const LISTS: { key: Exclude<keyof Reconciled, "articlesToCheck">; label: string; pill: string; help: string }[] = [
  { key: "newArticles", label: "New articles to add", pill: "ok", help: "Qualifying (restocked) articles that are not in this campaign at all. Add these FSNs." },
  { key: "addSizes", label: "Sizes to add", pill: "ok", help: "Articles already in the campaign; these qualifying sizes are missing from it." },
  { key: "resume", label: "To resume", pill: "ok", help: "Paused in the campaign, but the article has enough sizes again and this size is available." },
  { key: "pause", label: "To pause", pill: "bad", help: "Running, but the article has fewer sizes than the minimum to keep it active." },
  { key: "review", label: "Keep running – check", pill: "warn", help: "Running with enough sizes to stay on, but fewer than needed for a new add. Keep an eye on stock." },
  { key: "sizeOos", label: "Size out of stock", pill: "warn", help: "Article is fine, but this size is not live / has no stock. Flipkart stops serving it; pausing is optional." },
  { key: "notInUpload", label: "Not in upload", pill: "warn", help: "Running FSNs that are not in the current QOH upload (no stock data). Check them, usually pause." },
  { key: "running", label: "Running OK", pill: "grey", help: "Running and qualifying." },
  { key: "keepPaused", label: "Keep paused", pill: "grey", help: "Paused and should stay paused." },
];

export default function ReportsPage({ s }: { s: AppState }) {
  const [metas, setMetas] = useState<ReportMeta[]>([]);
  const [rep, setRep] = useState<CampaignReport | null>(null);
  const [tab, setTab] = useState<(typeof LISTS)[number]["key"]>("newArticles");
  const [msg, setMsg] = useState<{ kind: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [prog, setProg] = useState({ done: 0, total: 0 });
  const [linking, setLinking] = useState(false);

  useEffect(() => { api.listReports().then(setMetas).catch((e) => setMsg({ kind: "bad", text: String(e) })); }, []);

  const camp = rep?.planner ? s.config.campaigns.find((c) => c.name === rep.planner) ?? null : null;
  const rec = useMemo(() => (rep && camp && s.rows.length ? reconcile(rep, camp, s.rows, s.config.settings, s.latestRun?.results ?? [], s.register) : null), [rep, camp, s.rows, s.config.settings, s.latestRun, s.register]);

  async function save(r: CampaignReport) {
    const meta = metaOf(r);
    await api.saveReport(r, meta);
    setMetas((p) => [meta, ...p.filter((x) => x.id !== r.id)]);
    setRep(r);
  }

  async function onFiles(files: FileList) {
    setMsg(null); setBusy("upload");
    const notes: string[] = [];
    let last: CampaignReport | null = null;
    let reg = s.register;
    try {
      for (const f of Array.from(files)) {
        try {
          const r = parseReport(await f.text(), f.name);
          const old = metas.find((m) => m.id === r.id);
          r.planner = old?.planner ?? s.config.campaigns.find((c) => c.fromReport === r.id || c.name === r.fkName)?.name ?? null;
          await save(r);
          if (r.planner && s.rows.length) {
            const sync = syncRegister(reg, r, s.rows);
            if (sync.changed) { reg = sync.next; notes.push(`${r.fkName}: pause register updated for ${sync.changed} article(s) from the report`); }
          }
          notes.push(`${r.fkName}: ${r.rows.length} FSNs${r.planner ? ` · linked to “${r.planner}”` : " · not linked yet"}`);
          last = r;
        } catch (e) { notes.push(String(e instanceof Error ? e.message : e)); }
      }
      if (reg !== s.register) await s.setRegister(reg);
      if (last) { setRep(last); setLinking(!last.planner); setTab("newArticles"); }
      setMsg({ kind: "ok", text: notes.join(" · ") });
    } finally { setBusy(""); }
  }

  async function open(id: string) {
    setBusy(`open-${id}`);
    try { const r = await api.getReport(id); setRep(r); setLinking(!r.planner); setTab("newArticles"); } finally { setBusy(""); }
  }

  async function runCheck() {
    if (!rep || !rec) return;
    setBusy("check"); setProg({ done: 0, total: rec.articlesToCheck.length });
    try {
      const results = await checkArticles(rep.planner ?? rep.fkName, rec.articlesToCheck, s.rows, s.config.settings.min_live_sizes, (d) => setProg((p) => ({ ...p, done: d })));
      await save({ ...rep, check: { at: new Date().toISOString(), results } });
      const failed = results.filter((r) => r.status === "Check failed").length;
      setMsg({ kind: failed ? "warn" : "ok", text: `Checked ${results.length} articles on Flipkart${failed ? ` · ${failed} could not be checked (stock used for those)` : ""}.` });
    } catch (e) { setMsg({ kind: "bad", text: String(e) }); }
    finally { setBusy(""); }
  }

  const px = prefixOf(s.config.settings.brand);
  const today = new Date().toISOString().slice(0, 10);
  const base = rep ? safeName(rep.planner ?? rep.fkName) : "";

  function downloadAll() {
    if (!rec || !rep) return;
    const summary = LISTS.map((l) => ({ List: l.label, FSNs: rec[l.key].length, Articles: new Set(rec[l.key].map((r) => r.article)).size, Meaning: l.help }));
    download(`${px}${base}_Campaign_Actions_${today}.xlsx`, sheetsToXlsx({
      Summary: [...summary, {}, { List: `Flipkart campaign: ${rep.fkName} (${rep.id})` }, { List: `Report period: ${rep.start} to ${rep.end}` },
        { List: `Stock: ${s.snapshot?.fileName ?? "—"}` }, { List: `Live check: ${rep.check ? new Date(rep.check.at).toLocaleString("en-IN") : s.latestRun ? `latest app check ${new Date(s.latestRun.at).toLocaleString("en-IN")}` : "none – stock only"}` }],
      ...Object.fromEntries(LISTS.map((l) => [l.label, actionSheet(rec[l.key])])),
    }), XL);
  }
  function downloadNew() {
    if (!rec) return;
    download(`${px}${base}_New_Articles_To_Add_${today}.xlsx`, sheetsToXlsx({
      "New articles to add": actionSheet(rec.newArticles), "Sizes to add": actionSheet(rec.addSizes),
    }), XL);
  }
  function downloadCsv(rows: ActionRow[], label: string) {
    for (const f of buildCsvFiles(px, `${rep?.planner ?? rep?.fkName}_${label}`, rows.map((r) => r.fsn))) download(f.name, f.content);
  }

  return (
    <>
      <div className="topbar"><h2>Campaign reports</h2></div>
      <div className="card">
        <div className="drop">
          <p><b>Upload Flipkart campaign FSN reports (.csv)</b></p>
          <p className="muted">The “All FSNs of campaign” export from Flipkart Ads. You can upload several at once. Each report is compared with the current QOH upload and live check: what to add (restocked articles), resume, pause, and what is running.</p>
          <input type="file" accept=".csv" multiple disabled={!!busy} onChange={(e) => e.target.files?.length && onFiles(e.target.files)} />
        </div>
        {!s.rows.length && <div className="alert warn" style={{ marginTop: 12 }}>Upload the QOH inventory first — the report is compared with it.</div>}
        {busy === "upload" && <p className="muted">Reading reports…</p>}
        {msg && <div className={`alert ${msg.kind}`} style={{ marginTop: 12 }}>{msg.text}</div>}
      </div>

      {metas.length > 0 && (
        <div className="card">
          <h3>Uploaded reports</h3>
          <table><thead><tr><th>Flipkart campaign</th><th>Period</th><th>Linked to</th><th className="num">Running</th><th className="num">Paused</th><th>Uploaded</th><th>Flipkart check</th><th></th></tr></thead>
            <tbody>{metas.map((m) => (
              <tr key={m.id} className={rep?.id === m.id ? "alt" : ""}>
                <td>{m.fkName}</td><td>{m.start} – {m.end}</td>
                <td>{m.planner ?? <span className="pill warn">Not linked</span>}</td>
                <td className="num">{m.running}</td><td className="num">{m.paused}</td>
                <td>{new Date(m.uploadedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</td>
                <td>{m.checkedAt ? new Date(m.checkedAt).toLocaleString("en-IN") : "—"}</td>
                <td className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="btn small ghost" disabled={!!busy} onClick={() => open(m.id)}>{busy === `open-${m.id}` ? "Opening…" : "Open"}</button>
                  <button className="btn small danger" disabled={!!busy} onClick={async () => {
                    if (!window.confirm(`Delete the report for ${m.fkName}?`)) return;
                    await api.clear("reports", m.id); setMetas((p) => p.filter((x) => x.id !== m.id)); if (rep?.id === m.id) setRep(null);
                  }}>Delete</button>
                </td>
              </tr>
            ))}</tbody></table>
        </div>
      )}

      {rep && linking && <LinkPanel s={s} rep={rep} onLinked={async (name) => { await save({ ...rep, planner: name }); setLinking(false); }} onCancel={() => setLinking(false)} />}

      {rep && rep.planner && !linking && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <h3 style={{ marginBottom: 4 }}>{rep.fkName}</h3>
              <div className="muted">Linked to <b>{rep.planner}</b>{camp && !camp.active ? " (tracking only)" : ""} · report {rep.start} – {rep.end} · {rep.rows.length} FSNs · spend {inr(rep.rows.reduce((n, r) => n + r.spend, 0))}</div>
            </div>
            <button className="btn small ghost" onClick={() => setLinking(true)}>Change link</button>
          </div>
          {!camp && <div className="alert bad" style={{ marginTop: 12 }}>The linked campaign “{rep.planner}” no longer exists in Settings. Link the report again.</div>}
          {rec && (
            <>
              <div className="row" style={{ margin: "14px 0" }}>
                <button className="btn" disabled={!!busy} onClick={runCheck}>{busy === "check" ? `Checking ${prog.done}/${prog.total}…` : `Check these articles on Flipkart (${rec.articlesToCheck.length})`}</button>
                <span className="muted">{rep.check ? `Last checked ${new Date(rep.check.at).toLocaleString("en-IN")}` : "Not checked yet — results use the latest app live check where available, otherwise stock only."}</span>
              </div>
              {(() => {
                const so = new Set(LISTS.flatMap((l) => rec[l.key]).filter((r) => r.basis === "Stock only" && r.article).map((r) => r.article)).size;
                return so > 0 && !rep.check ? <div className="alert warn">{so} article(s) are judged on stock only (no Flipkart check yet). Run “Check these articles on Flipkart” before adding or resuming.</div> : null;
              })()}
              {busy === "check" && <div className="progress" style={{ marginBottom: 12 }}><div style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} /></div>}
              <div className="row" style={{ marginBottom: 14 }}>
                <button className="btn" onClick={downloadAll}>Download action report (Excel)</button>
                <button className="btn ghost" disabled={!rec.newArticles.length && !rec.addSizes.length} onClick={downloadNew}>New articles report (Excel)</button>
                <button className="btn ghost" disabled={!rec.newArticles.length && !rec.addSizes.length} onClick={() => downloadCsv([...rec.newArticles, ...rec.addSizes], "FSNs_to_add")}>Flipkart CSV – FSNs to add</button>
              </div>
              <div className="tabs">{LISTS.map((l) => (
                <button key={l.key} className={tab === l.key ? "on" : ""} onClick={() => setTab(l.key)}>{l.label} · {rec[l.key].length}</button>
              ))}</div>
              <p className="muted">{LISTS.find((l) => l.key === tab)?.help}</p>
              <ActionTable rows={rec[tab]} />
            </>
          )}
          {!s.rows.length && <p className="muted">Upload the QOH inventory to see actions.</p>}
        </div>
      )}
    </>
  );
}

function ActionTable({ rows }: { rows: ActionRow[] }) {
  let prev = ""; let alt = false;
  return (
    <div className="tablewrap">
      <table>
        <thead><tr><th>Model</th><th>Article</th><th>Color</th><th>FSN</th><th>Size</th><th className="num">QOH</th><th>In campaign</th><th>Live sizes</th><th>Reason</th><th className="num">Clicks</th><th className="num">Spend</th><th className="num">ROI</th></tr></thead>
        <tbody>{rows.map((r) => {
          if (r.article !== prev) { alt = !alt; prev = r.article; }
          return (
            <tr key={r.fsn} className={alt ? "alt" : ""}>
              <td>{r.model}</td><td>{r.article}</td><td>{r.color}</td><td>{r.fsn}</td><td>{r.size}</td><td className="num">{r.qoh}</td>
              <td>{r.status === "PAUSED" ? <span className="pill grey">Paused</span> : r.status === "Not in campaign" ? <span className="pill warn">Not in campaign</span> : <span className="pill ok">Running</span>}</td>
              <td>{r.liveSizes}{r.basis !== "Live check" && r.liveSizes ? <span className="muted" style={{ fontSize: 11 }}> ({r.basis === "Stock only" ? "stock" : "earlier check"})</span> : null}</td>
              <td className="muted" style={{ fontSize: 12 }}>{r.reason}</td>
              <td className="num">{r.clicks || ""}</td><td className="num">{r.spend ? inr(r.spend) : ""}</td><td className="num">{r.roi}</td>
            </tr>
          );
        })}</tbody>
      </table>
      {!rows.length && <p className="muted" style={{ padding: 10 }}>Nothing here.</p>}
    </div>
  );
}

function LinkPanel({ s, rep, onLinked, onCancel }: { s: AppState; rep: CampaignReport; onLinked: (name: string) => Promise<void>; onCancel: () => void }) {
  const sug = useMemo(() => suggestCampaign(rep, s.rows), [rep, s.rows]);
  const [pick, setPick] = useState(rep.planner ?? "");
  const [name, setName] = useState(rep.fkName);
  const [gender, setGender] = useState(sug.gender);
  const [vs, setVs] = useState(sug.verticals.map((v) => ({ ...v, on: v.share >= 0.1 })));
  const [err, setErr] = useState("");
  async function create() {
    const n = name.trim();
    if (!n) { setErr("Give the campaign a name."); return; }
    if (s.config.campaigns.some((c) => c.name === n)) { setErr("A campaign with this name already exists — pick it from the list instead."); return; }
    const rules = rulesFrom(vs.filter((v) => v.on));
    if (!rules.length) { setErr("Tick at least one vertical."); return; }
    await s.setConfig({ ...s.config, campaigns: [...s.config.campaigns, { name: n, gender, active: false, rules, fromReport: rep.id }] });
    await onLinked(n);
  }
  return (
    <div className="card">
      <h3>Link “{rep.fkName}” to a campaign</h3>
      <div className="camp">
        <b>Option 1 — it is one of the planner campaigns</b>
        <div className="row" style={{ marginTop: 8 }}>
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Select campaign…</option>
            {s.config.campaigns.map((c) => <option key={c.name}>{c.name}</option>)}
          </select>
          <button className="btn small" disabled={!pick} onClick={() => onLinked(pick)}>Link</button>
          {rep.planner && <button className="btn small ghost" onClick={onCancel}>Cancel</button>}
        </div>
      </div>
      <div className="camp">
        <b>Option 2 — create a new campaign from this report</b>
        <p className="muted">Rules are suggested from the report's FSNs in the current QOH upload (vertical + MRP range). Untick verticals that were added by mistake. The new campaign is saved as “tracking only” (not in the upload files); you can switch it on in Settings.</p>
        {!s.rows.length && <div className="alert warn">Upload the QOH inventory first so the rules can be suggested.</div>}
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 300 }} />
          <select value={gender} onChange={(e) => setGender(e.target.value as typeof gender)}><option>Men</option><option>Women</option></select>
        </div>
        <table style={{ marginTop: 10 }}>
          <thead><tr><th></th><th>Vertical</th><th className="num">FSNs in report</th><th>MRP from (₹)</th><th>MRP to (₹)</th></tr></thead>
          <tbody>{vs.map((v, i) => (
            <tr key={v.vertical}>
              <td><input type="checkbox" checked={v.on} onChange={(e) => setVs(vs.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} /></td>
              <td>{v.vertical}</td><td className="num">{v.fsns} ({Math.round(v.share * 100)}%)</td>
              <td><input type="number" value={v.min} onChange={(e) => setVs(vs.map((x, j) => (j === i ? { ...x, min: +e.target.value } : x)))} /></td>
              <td><input type="number" value={v.max} onChange={(e) => setVs(vs.map((x, j) => (j === i ? { ...x, max: +e.target.value } : x)))} /></td>
            </tr>
          ))}</tbody>
        </table>
        {sug.missing > 0 && <p className="muted">{sug.missing} FSN(s) of the report are not in the current QOH upload.</p>}
        {err && <div className="alert bad" style={{ marginTop: 10 }}>{err}</div>}
        <button className="btn" style={{ marginTop: 10 }} disabled={!s.rows.length} onClick={create}>Create campaign and link</button>
      </div>
    </div>
  );
}
