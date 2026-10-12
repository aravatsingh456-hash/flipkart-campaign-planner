import { useMemo, useState } from "react";
import type { AppState } from "../App";
import { DEFAULT_CONFIG, type Campaign, type Config } from "../lib/defaults";
import { mrpTable } from "../lib/processing";

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export default function SettingsPage({ s }: { s: AppState }) {
  const [draft, setDraft] = useState<Config>(clone(s.config));
  const [msg, setMsg] = useState("");
  const verticals = useMemo(() => [...new Set(s.rows.map((r) => r.vertical))].sort(), [s.rows]);
  const table = useMemo(() => mrpTable(s.rows), [s.rows]);
  const set = (fn: (d: Config) => void) => setDraft((p) => { const n = clone(p); fn(n); return n; });
  const dirty = JSON.stringify(draft) !== JSON.stringify(s.config);

  async function save() {
    const names = draft.campaigns.map((c) => c.name.trim());
    if (names.some((n) => !n) || new Set(names).size !== names.length) { setMsg("Every campaign needs a unique name."); return; }
    await s.setConfig(draft); setMsg("Saved. Campaign lists are recalculated with these settings.");
  }
  const sizesStr = (a: string[]) => a.join(", ");
  const parseSizes = (v: string) => v.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

  return (
    <>
      <div className="topbar">
        <h2>Settings</h2>
        <div className="row">
          <button className="btn ghost" onClick={() => { setDraft(clone(DEFAULT_CONFIG)); setMsg("Defaults loaded — click Save to apply."); }}>Reset to defaults</button>
          <button className="btn" disabled={!dirty} onClick={save}>Save settings</button>
        </div>
      </div>
      {msg && <div className="alert ok">{msg}</div>}

      <div className="card">
        <h3>Rules</h3>
        <div className="grid">
          <label>Brand name (used in file names)<br /><input value={draft.settings.brand} onChange={(e) => set((d) => { d.settings.brand = e.target.value; })} /></label>
          <label>Min QOH per size<br /><input type="number" value={draft.settings.min_qoh} onChange={(e) => set((d) => { d.settings.min_qoh = +e.target.value; })} /></label>
          <label>Min sizes to select an article (upload)<br /><input type="number" value={draft.settings.min_sizes_select} onChange={(e) => set((d) => { d.settings.min_sizes_select = +e.target.value; })} /></label>
          <label>Min live sizes to keep active<br /><input type="number" value={draft.settings.min_live_sizes} onChange={(e) => set((d) => { d.settings.min_live_sizes = +e.target.value; })} /></label>
          <label>Core sizes – Men<br /><input key={"m"+sizesStr(draft.settings.core_men)} defaultValue={sizesStr(draft.settings.core_men)} onBlur={(e) => set((d) => { d.settings.core_men = parseSizes(e.target.value); })} /></label>
          <label>Core sizes – Women<br /><input key={"w"+sizesStr(draft.settings.core_women)} defaultValue={sizesStr(draft.settings.core_women)} onBlur={(e) => set((d) => { d.settings.core_women = parseSizes(e.target.value); })} /></label>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3>Campaigns</h3>
          <button className="btn small ghost" onClick={() => set((d) => { d.campaigns.push({ name: `New campaign ${d.campaigns.length + 1}`, gender: "Men", active: true, rules: [{ vertical: verticals[0] ?? "", mrp_from: 0, mrp_to: 99999 }] }); })}>+ Add campaign</button>
        </div>
        <datalist id="verticals">{verticals.map((v) => <option key={v} value={v} />)}</datalist>
        {draft.campaigns.map((c: Campaign, i) => (
          <div className="camp" key={i}>
            <div className="row">
              <input style={{ minWidth: 260, fontWeight: 600 }} value={c.name} onChange={(e) => set((d) => { d.campaigns[i].name = e.target.value; })} />
              <select value={c.gender} onChange={(e) => set((d) => { d.campaigns[i].gender = e.target.value as Campaign["gender"]; })}><option>Men</option><option>Women</option></select>
              <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={c.active} onChange={(e) => set((d) => { d.campaigns[i].active = e.target.checked; })} /> Active</label>
              {c.fromReport && <span className="pill grey" title="Created from a Flipkart campaign report. When Active is off it is only used on the Campaign reports page.">From report {c.fromReport}</span>}
              <span style={{ flex: 1 }} />
              <button className="btn small ghost" disabled={i === 0} onClick={() => set((d) => { [d.campaigns[i - 1], d.campaigns[i]] = [d.campaigns[i], d.campaigns[i - 1]]; })}>↑</button>
              <button className="btn small ghost" disabled={i === draft.campaigns.length - 1} onClick={() => set((d) => { [d.campaigns[i + 1], d.campaigns[i]] = [d.campaigns[i], d.campaigns[i + 1]]; })}>↓</button>
              <button className="btn small danger" onClick={() => set((d) => { d.campaigns.splice(i, 1); })}>Delete</button>
            </div>
            {c.rules.map((r, k) => (
              <div className="row" key={k} style={{ marginTop: 8, paddingLeft: 12 }}>
                <span className="muted">Vertical</span>
                <input list="verticals" style={{ minWidth: 230 }} value={r.vertical} onChange={(e) => set((d) => { d.campaigns[i].rules[k].vertical = e.target.value; })} />
                <span className="muted">MRP ₹</span>
                <input type="number" value={r.mrp_from} onChange={(e) => set((d) => { d.campaigns[i].rules[k].mrp_from = +e.target.value; })} />
                <span className="muted">to ₹</span>
                <input type="number" value={r.mrp_to} onChange={(e) => set((d) => { d.campaigns[i].rules[k].mrp_to = +e.target.value; })} />
                <button className="btn small danger" disabled={c.rules.length === 1} onClick={() => set((d) => { d.campaigns[i].rules.splice(k, 1); })}>Remove</button>
              </div>
            ))}
            <button className="btn small ghost" style={{ marginTop: 8, marginLeft: 12 }} onClick={() => set((d) => { d.campaigns[i].rules.push({ vertical: "", mrp_from: 0, mrp_to: 99999 }); })}>+ Add vertical</button>
          </div>
        ))}
        <p className="muted">Campaign order matters: if an FSN fits two campaigns, it stays in the first one.</p>
      </div>

      <div className="card">
        <h3>QOH by MRP point (helps choose Low/High split)</h3>
        {!table.length && <p className="muted">Upload inventory to see this table.</p>}
        <div className="tablewrap" style={{ maxHeight: 420 }}>
          <table>
            <thead><tr><th>Vertical</th><th className="num">Total QOH</th><th>MRP ₹ : QOH</th></tr></thead>
            <tbody>{table.map((t) => (
              <tr key={t.vertical}><td>{t.vertical}</td><td className="num">{t.total.toLocaleString("en-IN")}</td>
                <td className="chips">{t.points.map(([m, q]) => <span key={m}>₹{m.toLocaleString("en-IN")}: <b>{q.toLocaleString("en-IN")}</b></span>)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </>
  );
}
