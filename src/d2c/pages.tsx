import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import type { D2CState } from "./D2CApp";
import { d2cApi } from "./api";
import { ASICS_BATCH, fetchAsics, type WebMap } from "./asics";
import { parseD2C } from "./parse";
import { buildDetailed, buildIds, buildRegisterFile } from "./exports";
import { activeOf, applyD2CRun, diffRuns, fmtDate, GROUPS, processD2C, sortSizes, type Article, type D2CRegEntry, type D2CRun, type D2CSettings, type Group } from "./model";
import { download, safeName } from "../lib/exports";

const XL = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const px = (st: D2CSettings) => (st.brand.trim() ? `${safeName(st.brand)}_` : "");
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

function GenderPill({ g }: { g: string }) {
  return <span className={`pill ${g === "Unisex" ? "warn" : "grey"}`}>{g}</span>;
}
function StatusPill({ a }: { a: Article }) {
  if (a.status === "Listed") return <span className="pill ok">Listed</span>;
  if (a.status === "Excluded") return <span className="pill bad" title={a.reason}>Excluded</span>;
  return <span className="pill grey" title={a.reason}>Not checked</span>;
}

/** The four files (detailed + ID list for each group). */
function Downloads({ s }: { s: D2CState }) {
  const [busy, setBusy] = useState("");
  const st = s.config.settings;
  if (!s.run || !s.snapshot) return <div className="alert warn">Run the website check to get the files — the lists only include sizes that are live on the website.</div>;
  const checked = new Date(s.run.at).toLocaleString("en-IN");
  const d = day(s.run.at);
  const files: { key: string; label: string; make: () => Promise<[string, ArrayBuffer]> }[] = GROUPS.flatMap((g: Group) => {
    const gn = g === "Discounted" ? "Discounted" : "Non_Discounted";
    return [
      { key: `det-${g}`, label: `${g} – detailed sheet`, make: async () => [`${px(st)}D2C_${gn}_Products_${d}.xlsx`, await buildDetailed(g, s.result, st, s.snapshot!.fileName, checked)] as [string, ArrayBuffer] },
      { key: `ids-${g}`, label: `${g} – Meta / Google IDs`, make: async () => [`${px(st)}D2C_${gn}_Product_IDs_${d}.xlsx`, await buildIds(g, s.result)] as [string, ArrayBuffer] },
    ];
  });
  const one = async (f: (typeof files)[number]) => { const [n, b] = await f.make(); download(n, b, XL); };
  return (
    <div className="row">
      <button className="btn" disabled={!!busy} onClick={async () => { setBusy("all"); try { for (const f of files) { await one(f); await new Promise((r) => setTimeout(r, 400)); } } finally { setBusy(""); } }}>
        {busy === "all" ? "Preparing…" : "Download all 4 files"}
      </button>
      {files.map((f) => (
        <button key={f.key} className="btn small ghost" disabled={!!busy} onClick={async () => { setBusy(f.key); try { await one(f); } finally { setBusy(""); } }}>
          {busy === f.key ? "Preparing…" : f.label}
        </button>
      ))}
    </div>
  );
}

// ---------------- Campaigns ----------------
export function D2CCampaignsPage({ s }: { s: D2CState }) {
  const [group, setGroup] = useState<Group>("Discounted");
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState("");
  if (!s.snapshot) return (
    <div className="card" style={{ textAlign: "center", padding: 40 }}>
      <h3>No stock file yet</h3><p className="muted">Upload the website discount / stock file to build the D2C campaigns.</p>
      <button className="btn" onClick={() => s.go("upload")}>Upload stock file</button>
    </div>
  );
  const camps = s.result.campaigns.filter((c) => c.group === group);
  const excluded = s.result.articles.filter((a) => a.group === group && a.status !== "Listed" && (s.run || a.status === "Excluded"));
  const tabs = [...camps.map((c) => ({ name: c.name, list: c.articles })), ...(s.run ? [{ name: "Not included", list: excluded.filter((a) => a.status !== "Listed") }] : [])];
  const cur = tabs[Math.min(tab, tabs.length - 1)];
  const t = q.trim().toLowerCase();
  const list = cur.list.filter((a) => !t || [a.name, a.option, a.type].some((x) => x.toLowerCase().includes(t)));
  return (
    <>
      <div className="topbar"><h2>D2C campaigns</h2>
        <div className="tabs" style={{ margin: 0 }}>{GROUPS.map((g) => <button key={g} className={g === group ? "on" : ""} onClick={() => { setGroup(g); setTab(0); }}>{g}</button>)}</div>
      </div>
      {!s.run && <div className="alert warn">Website check not run for this upload yet — showing the file rule only. Open “Website check” to confirm live sizes and get the files.</div>}
      <div className="card"><h3>Files</h3><Downloads s={s} /></div>
      <div className="tabs">{tabs.map((x, i) => (
        <button key={x.name} className={i === tab ? "on" : ""} onClick={() => setTab(i)}>{x.name} · {x.list.length}</button>
      ))}</div>
      <div className="row" style={{ marginBottom: 10 }}>
        <input placeholder="Search product, option, shoe type" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 280 }} />
        <span className="muted">{list.length} articles · {list.reduce((n, a) => n + a.rows.length, 0)} SKUs</span>
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Product</th><th>Option</th><th>Gender</th><th>Shoe type</th><th className="num">MRP</th><th className="num">Disc</th><th className="num">Sale price</th>
            <th>{cur.name === "Not included" ? "Campaign" : "Sizes listed (SOH)"}</th><th>Live on website</th><th>Status</th></tr></thead>
          <tbody>{list.map((a, i) => (
            <tr key={a.key} className={i % 2 ? "alt" : ""}>
              <td>{a.web?.url ? <a href={a.web.url} target="_blank" rel="noreferrer">{a.name}</a> : a.name}</td>
              <td>{a.option}</td><td><GenderPill g={a.gender} /></td><td>{a.type}</td>
              <td className="num">{inr(a.mrp)}</td><td className="num">{Math.round(a.disc * 100)}%</td><td className="num">{inr(a.sale)}</td>
              <td className="chips">{cur.name === "Not included" ? `${a.cg} · ${a.campaign}` : (a.status === "Listed" ? a.rows : a.good).map((x) => <span key={x.size}>{x.size} · {x.soh}</span>)}</td>
              <td>{a.web ? (a.web.found ? sortSizes(a.web.live).join(", ") : "—") : ""}</td>
              <td><StatusPill a={a} />{a.reason && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{a.reason}</div>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}

// ---------------- Upload ----------------
export function D2CUploadPage({ s }: { s: D2CState }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  async function onFile(f: File) {
    setErr(""); setDone(""); setBusy(true);
    try {
      const book = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const p = parseD2C(book, s.config.settings);
      if (p.error) { setErr(p.error); return; }
      if (!p.tuples.length) { setErr(`No rows with SOH > 0 in categories ${s.config.settings.categories.map((c) => c.code).join(", ")}.`); return; }
      const meta = { id: `${Date.now()}`, fileName: f.name, uploadedAt: new Date().toISOString(), rowCount: p.tuples.length, sheet: p.sheet };
      await d2cApi.saveSnapshot(meta, p.tuples);
      s.addSnapshot(meta, p.tuples);
      setDone(`Read sheet "${p.sheet}": ${p.total.toLocaleString("en-IN")} rows, ${p.tuples.length.toLocaleString("en-IN")} footwear rows with stock saved.`);
    } catch (e) { setErr(`Upload failed: ${String(e)}`); }
    finally { setBusy(false); }
  }
  const fo = s.fileOnly;
  const opts = new Set(fo.articles.map((a) => a.option)).size;
  return (
    <>
      <div className="topbar"><h2>Upload stock file</h2></div>
      <div className="card">
        <div className="drop">
          <p><b>Upload the website discount / stock Excel (.xlsx)</b></p>
          <p className="muted">The header row is found automatically. Needed columns: sku, Product Name, Option, Category, Gender, MRP, SOH and the discount % column (Legends/Non-Legends and Season are used when present).</p>
          <input type="file" accept=".xlsx,.xls" disabled={busy} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </div>
        {busy && <p className="muted">Reading and saving…</p>}
        {err && <div className="alert bad" style={{ marginTop: 12 }}>{err}</div>}
        {done && <div className="alert ok" style={{ marginTop: 12 }}>{done}</div>}
      </div>
      {s.snapshot && (
        <div className="card">
          <h3>Next step: website check</h3>
          <p className="muted">{opts} articles pass the stock rule in the file. The website check confirms which sizes are live on the site and builds the four files.</p>
          <button className="btn" onClick={() => s.go("check")}>Go to website check</button>
        </div>
      )}
    </>
  );
}

// ---------------- Settings ----------------
export function D2CSettingsPage({ s }: { s: D2CState }) {
  const [st, setSt] = useState<D2CSettings>(s.config.settings);
  const [core, setCore] = useState(s.config.settings.men_core.join(", "));
  const [msg, setMsg] = useState("");
  const set = <K extends keyof D2CSettings>(k: K, v: D2CSettings[K]) => { setSt({ ...st, [k]: v }); setMsg(""); };
  const setCat = (i: number, k: "code" | "label" | "high_from", v: string) =>
    set("categories", st.categories.map((c, j) => (j === i ? { ...c, [k]: k === "high_from" ? Number(v) || 0 : k === "code" ? v.toUpperCase().trim() : v } : c)));
  async function save() {
    const next = { ...st, men_core: core.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean), categories: st.categories.filter((c) => c.code) };
    await s.setConfig({ settings: next }); setSt(next); setMsg("Saved. Campaigns update straight away — no new website check needed unless new articles appear.");
  }
  return (
    <>
      <div className="topbar"><h2>D2C settings</h2><button className="btn" onClick={save}>Save settings</button></div>
      {msg && <div className="alert ok">{msg}</div>}
      <div className="card">
        <h3>Stock rules</h3>
        <div className="grid">
          <label>Brand (used in file names)<br /><input value={st.brand} onChange={(e) => set("brand", e.target.value)} /></label>
          <label>Minimum SOH per size<br /><input type="number" value={st.min_soh} onChange={(e) => set("min_soh", Number(e.target.value) || 0)} /></label>
          <label>Men: core sizes (all needed)<br /><input value={core} onChange={(e) => { setCore(e.target.value); setMsg(""); }} /></label>
          <label>Women: minimum number of sizes<br /><input type="number" value={st.women_min_sizes} onChange={(e) => set("women_min_sizes", Number(e.target.value) || 0)} /></label>
          <label className="row"><input type="checkbox" checked={st.include_unisex} onChange={(e) => set("include_unisex", e.target.checked)} /> Include Unisex in both Men and Women</label>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>Size = the part of the sku after the last dot, used as it is. A size counts only if its SOH meets the minimum in the file and it is in stock on the website.</p>
      </div>
      <div className="card">
        <h3>Categories and AOV split</h3>
        <p className="muted">Sale price = MRP × (1 − discount). High AOV when the sale price is at or above the cut-off. Each category makes Men / Women × High / Low campaigns, for Discounted and Non-discounted separately.</p>
        <table><thead><tr><th>Category code (as in file)</th><th>Label</th><th>High AOV from (₹)</th><th></th></tr></thead>
          <tbody>{st.categories.map((c, i) => (
            <tr key={i}>
              <td><input value={c.code} onChange={(e) => setCat(i, "code", e.target.value)} /></td>
              <td><input value={c.label} onChange={(e) => setCat(i, "label", e.target.value)} style={{ width: 280 }} /></td>
              <td><input type="number" value={c.high_from} onChange={(e) => setCat(i, "high_from", e.target.value)} /></td>
              <td><button className="btn small danger" onClick={() => set("categories", st.categories.filter((_, j) => j !== i))}>Remove</button></td>
            </tr>
          ))}</tbody></table>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn small ghost" onClick={() => set("categories", [...st.categories, { code: "", label: "", high_from: 5000 }])}>Add category</button>
          <span className="muted">A newly added category needs a fresh upload (only these categories are saved from the file).</span>
        </div>
      </div>
    </>
  );
}

// ---------------- Website check ----------------
const PAR = 3;
export function D2CCheckPage({ s }: { s: D2CState }) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");
  const [diff, setDiff] = useState<ReturnType<typeof diffRuns>>(null);
  const [regTab, setRegTab] = useState<"pause" | "resume" | "paused">("pause");
  const st = s.config.settings;
  const options = useMemo(() => [...new Set(s.fileOnly.articles.map((a) => a.option))], [s.fileOnly]);

  async function runCheck() {
    if (!s.snapshot) return;
    setRunning(true); setErr(""); setDone(0); setTotal(options.length); setDiff(null);
    try {
      const prevMeta = s.runs[0];
      const prev = prevMeta ? (s.run?.id === prevMeta.id ? s.run : await d2cApi.getRun(prevMeta.id)) : null;
      const batches: string[][] = [];
      for (let i = 0; i < options.length; i += ASICS_BATCH) batches.push(options.slice(i, i + ASICS_BATCH));
      const web: WebMap = {};
      let failed = 0, fin = 0;
      const one = async (b: string[]) => {
        for (const how of ["browser", "browser", "server"] as const) {
          try { return how === "browser" ? await fetchAsics(b) : await d2cApi.check(b); } catch { /* try next */ }
        }
        failed += b.length; return {} as WebMap;
      };
      for (let i = 0; i < batches.length; i += PAR) {
        const part = batches.slice(i, i + PAR);
        (await Promise.all(part.map(one))).forEach((m) => Object.assign(web, m));
        fin += part.reduce((n, b) => n + b.length, 0); setDone(fin);
      }
      if (failed === options.length) throw new Error("The website could not be reached. Please try again in a few minutes.");
      const res = processD2C(s.rows, st, web);
      const active = activeOf(res);
      const at = new Date().toISOString();
      const run: D2CRun = {
        id: `${Date.now()}`, at, snapshotId: s.snapshot.id, options: options.length,
        notFound: Object.values(web).filter((w) => !w.found).length, failed, listed: Object.keys(active).length, web, active,
      };
      await d2cApi.saveRun(run);
      await s.setRegister(applyD2CRun(s.register, prev?.active ?? {}, res, at));
      s.addRun(run);
      setDiff(diffRuns(prev?.active ?? null, active));
      if (failed) setErr(`${failed} article(s) could not be checked and are left out of the files this time (marked "Not checked"). Run the check again to include them.`);
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    finally { setRunning(false); }
  }

  const reg = Object.values(s.register);
  const lists: Record<typeof regTab, D2CRegEntry[]> = {
    pause: reg.filter((e) => e.state === "To pause"),
    resume: reg.filter((e) => e.state === "Paused" && e.latest === "Active"),
    paused: reg.filter((e) => e.state === "Paused"),
  };
  const mark = async (keys: string[], state: "Paused" | "Resumed") => {
    const now = new Date().toISOString(); const next = { ...s.register };
    for (const k of keys) next[k] = state === "Paused" ? { ...next[k], state, pausedOn: now } : { ...next[k], state, resumedOn: now };
    await s.setRegister(next);
  };
  const regFile = async (kind: "pause" | "resume") =>
    download(`${px(st)}D2C_${kind === "pause" ? "To_Pause" : "To_Resume"}_${day(new Date().toISOString())}.xlsx`, await buildRegisterFile(kind, lists[kind], s.result), XL);

  const byGroup = (g: Group) => s.result.campaigns.filter((c) => c.group === g);
  const label = (k: string) => { const a = s.result.articles.find((x) => x.key === k); return a ? `${a.name} · ${a.option} → ${a.group} / ${a.campaign}` : k.replace("|", " · "); };

  return (
    <>
      <div className="topbar"><h2>Website check</h2></div>
      {!s.snapshot ? <div className="alert warn">Upload a stock file first.</div> : (
        <div className="card">
          <h3>Check live sizes on the website</h3>
          <p className="muted">{options.length} articles pass the stock rule in the file. Each one is looked up on the website: in-stock sizes, price, shoe type and product URL.</p>
          <div className="row">
            <button className="btn" disabled={running || !options.length} onClick={runCheck}>{running ? "Checking…" : s.run ? "Run website check again" : "Run website check"}</button>
            {running && <span className="muted">{done} / {total}</span>}
          </div>
          {running && <div className="progress" style={{ marginTop: 10 }}><div style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>}
          {err && <div className="alert warn" style={{ marginTop: 12 }}>{err}</div>}
        </div>
      )}
      {s.run && (
        <>
          <div className="card">
            <h3>Files for Meta and Google</h3>
            <p className="muted">From the check on {new Date(s.run.at).toLocaleString("en-IN")}: {s.run.listed} article entries listed, {s.run.notFound} not on the website{s.run.failed ? `, ${s.run.failed} not checked` : ""}.</p>
            <Downloads s={s} />
            {diff && (
              <div className="alert ok" style={{ marginTop: 12 }}>
                Since the previous check: <b>{diff.added.length}</b> new (add to product sets), <b>{diff.moved.length}</b> moved to another campaign, <b>{diff.removed.length}</b> dropped (see “To pause”).
                {[...diff.added.map((k) => `New: ${label(k)}`), ...diff.moved.map((k) => `Moved: ${label(k)}`)].slice(0, 30).map((t) => <div key={t} style={{ fontSize: 12 }}>{t}</div>)}
              </div>
            )}
            <table style={{ marginTop: 12 }}>
              <thead><tr><th>Campaign</th>{GROUPS.map((g) => <th key={g} className="num">{g} (articles / SKUs)</th>)}</tr></thead>
              <tbody>{byGroup("Discounted").map((c, i) => {
                const n = byGroup("Non-discounted")[i];
                return <tr key={c.name}><td>{c.name}</td>{[c, n].map((x, j) => <td key={j} className="num">{x.articles.length} / {x.articles.reduce((t, a) => t + a.rows.length, 0)}</td>)}</tr>;
              })}</tbody>
            </table>
          </div>
          <div className="card">
            <h3>Pause register</h3>
            <p className="muted">An article that was listed in the previous check and has now dropped out (stock or website) goes to “To pause”. Remove it from the Meta product set and the Google list, then mark it paused. When it qualifies again it shows under “Can resume”.</p>
            <div className="tabs">
              <button className={regTab === "pause" ? "on" : ""} onClick={() => setRegTab("pause")}>To pause · {lists.pause.length}</button>
              <button className={regTab === "resume" ? "on" : ""} onClick={() => setRegTab("resume")}>Can resume · {lists.resume.length}</button>
              <button className={regTab === "paused" ? "on" : ""} onClick={() => setRegTab("paused")}>Paused · {lists.paused.length}</button>
            </div>
            <div className="row" style={{ marginBottom: 10 }}>
              {regTab === "pause" && <><button className="btn small" disabled={!lists.pause.length} onClick={() => regFile("pause")}>Download to-pause list</button>
                <button className="btn small ghost" disabled={!lists.pause.length} onClick={() => mark(lists.pause.map((e) => e.key), "Paused")}>Mark all as paused</button></>}
              {regTab === "resume" && <><button className="btn small" disabled={!lists.resume.length} onClick={() => regFile("resume")}>Download resume list</button>
                <button className="btn small ghost" disabled={!lists.resume.length} onClick={() => mark(lists.resume.map((e) => e.key), "Resumed")}>Mark all as resumed</button></>}
            </div>
            <div className="tablewrap" style={{ maxHeight: "50vh" }}>
              <table>
                <thead><tr><th>Product</th><th>Option</th><th>Gender</th><th>Campaign</th><th>Flagged</th><th>Paused</th><th>Reason / status</th><th></th></tr></thead>
                <tbody>{lists[regTab].map((e) => (
                  <tr key={e.key}>
                    <td>{e.name}</td><td>{e.option}</td><td><GenderPill g={e.gender} /></td><td>{e.group ? `${e.group} · ` : ""}{e.campaign}</td>
                    <td>{fmtDate(e.flaggedOn)}</td><td>{fmtDate(e.pausedOn)}</td>
                    <td>{e.latest === "Active" ? <span className="pill ok">Qualifies again</span> : <span className="muted">{e.reason}</span>}</td>
                    <td>{e.state === "To pause" ? <button className="btn small ghost" onClick={() => mark([e.key], "Paused")}>Mark paused</button>
                      : e.latest === "Active" ? <button className="btn small ghost" onClick={() => mark([e.key], "Resumed")}>Mark resumed</button> : null}</td>
                  </tr>
                ))}</tbody>
              </table>
              {!lists[regTab].length && <p className="muted" style={{ padding: 10 }}>Nothing here.</p>}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ---------------- History ----------------
export function D2CHistoryPage({ s }: { s: D2CState }) {
  const [busy, setBusy] = useState("");
  async function clear(what: "uploads" | "runs" | "settings" | "all", id?: string, label?: string) {
    const msg = id ? `Delete this ${label}? This cannot be undone.`
      : { uploads: "Delete ALL D2C uploads?", runs: "Delete ALL D2C website checks and the D2C pause register?", settings: "Reset D2C settings to defaults?", all: "Delete EVERYTHING in D2C (uploads, checks, register and settings)? Flipkart data is not touched." }[what] + " This cannot be undone.";
    if (!window.confirm(msg)) return;
    setBusy(`${what}-${id ?? ""}`);
    try { await d2cApi.clear(what, id); window.location.reload(); }
    catch (e) { window.alert(`Could not delete: ${String(e)}`); setBusy(""); }
  }
  return (
    <>
      <div className="topbar"><h2>D2C history</h2></div>
      <div className="card">
        <h3>Uploads</h3>
        <table><thead><tr><th>Uploaded</th><th>File</th><th className="num">Footwear rows</th><th></th></tr></thead>
          <tbody>{s.snapshots.map((m) => (
            <tr key={m.id}><td>{new Date(m.uploadedAt).toLocaleString("en-IN")}</td><td>{m.fileName}</td><td className="num">{m.rowCount}</td>
              <td className="row" style={{ justifyContent: "flex-end" }}>
                {s.snapshot?.id === m.id ? <span className="pill ok">Current base</span> : <button className="btn small ghost" onClick={() => s.useSnapshot(m.id)}>Use as base</button>}
                <button className="btn small danger" disabled={!!busy} onClick={() => clear("uploads", m.id, "upload")}>Delete</button>
              </td></tr>
          ))}</tbody></table>
        {!s.snapshots.length && <p className="muted">No uploads yet.</p>}
      </div>
      <div className="card">
        <h3>Website checks</h3>
        <table><thead><tr><th>Checked at</th><th>Upload</th><th className="num">Articles</th><th className="num">Listed</th><th className="num">Not on site</th><th className="num">Not checked</th><th></th></tr></thead>
          <tbody>{s.runs.map((r) => (
            <tr key={r.id}><td>{new Date(r.at).toLocaleString("en-IN")}</td><td>{s.snapshots.find((x) => x.id === r.snapshotId)?.fileName ?? "—"}</td>
              <td className="num">{r.options}</td><td className="num">{r.listed}</td><td className="num">{r.notFound}</td><td className="num">{r.failed}</td>
              <td style={{ textAlign: "right" }}><button className="btn small danger" disabled={!!busy} onClick={() => clear("runs", r.id, "website check")}>Delete</button></td></tr>
          ))}</tbody></table>
        {!s.runs.length && <p className="muted">No checks yet.</p>}
      </div>
      <div className="card">
        <h3>Clear D2C data</h3>
        <p className="muted">Only D2C data is deleted here. Flipkart data stays as it is.</p>
        <div className="row">
          <button className="btn small danger" disabled={!!busy} onClick={() => clear("runs")}>Clear website checks & pause register</button>
          <button className="btn small danger" disabled={!!busy} onClick={() => clear("uploads")}>Clear all uploads</button>
          <button className="btn small danger" disabled={!!busy} onClick={() => clear("settings")}>Reset settings</button>
          <button className="btn danger" disabled={!!busy} onClick={() => clear("all")}>Clear all D2C data</button>
        </div>
      </div>
    </>
  );
}
