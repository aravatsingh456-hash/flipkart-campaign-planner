import { useEffect, useMemo, useState, type ReactNode } from "react";
import { D2C_DEFAULTS, fromTuple, processD2C, type D2CConfig, type D2CRegister, type D2CResult, type D2CRow, type D2CRun, type D2CRunMeta, type D2CTuple } from "./model";
import { d2cApi, type D2CSnapMeta } from "./api";
import { D2CCampaignsPage, D2CCheckPage, D2CHistoryPage, D2CSettingsPage, D2CUploadPage } from "./pages";

export type D2CPage = "campaigns" | "upload" | "settings" | "check" | "history";

export interface D2CState {
  config: D2CConfig;
  setConfig: (c: D2CConfig) => Promise<void>;
  snapshots: D2CSnapMeta[];
  snapshot: D2CSnapMeta | null;
  rows: D2CRow[];
  useSnapshot: (id: string) => Promise<void>;
  addSnapshot: (meta: D2CSnapMeta, t: D2CTuple[]) => void;
  runs: D2CRunMeta[];
  run: D2CRun | null;              // latest website check for the current upload
  addRun: (r: D2CRun) => void;
  register: D2CRegister;
  setRegister: (r: D2CRegister) => Promise<void>;
  result: D2CResult;               // with website data when `run` exists
  fileOnly: D2CResult;             // file rule only (what the website check will look up)
  go: (p: D2CPage) => void;
}

export default function D2CApp({ switcher }: { switcher: ReactNode }) {
  const [page, setPage] = useState<D2CPage>("campaigns");
  const [config, setConfigState] = useState<D2CConfig>({ settings: D2C_DEFAULTS });
  const [snapshots, setSnapshots] = useState<D2CSnapMeta[]>([]);
  const [snapshot, setSnapshot] = useState<D2CSnapMeta | null>(null);
  const [rows, setRows] = useState<D2CRow[]>([]);
  const [runs, setRuns] = useState<D2CRunMeta[]>([]);
  const [run, setRun] = useState<D2CRun | null>(null);
  const [register, setRegisterState] = useState<D2CRegister>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const loadRunFor = async (snapId: string, list: D2CRunMeta[]) => {
    const m = list.find((r) => r.snapshotId === snapId);
    setRun(m ? await d2cApi.getRun(m.id) : null);
  };

  useEffect(() => {
    document.title = "D2C Campaign Planner";
    (async () => {
      try {
        const [cfg, snaps, rs, reg] = await Promise.all([d2cApi.getConfig(), d2cApi.listSnapshots(), d2cApi.listRuns(), d2cApi.getRegister().catch(() => ({}))]);
        if (cfg) setConfigState({ settings: { ...D2C_DEFAULTS, ...cfg.settings } });
        setSnapshots(snaps); setRuns(rs); setRegisterState(reg ?? {});
        if (snaps[0]) {
          const s = await d2cApi.getSnapshot(snaps[0].id);
          setSnapshot(s.meta); setRows(s.rows.map(fromTuple));
          await loadRunFor(snaps[0].id, rs);
        }
      } catch (e) {
        setErr(`Could not load saved data: ${String(e)}`);
      } finally { setLoading(false); }
    })();
  }, []);

  const st = config.settings;
  const fileOnly = useMemo(() => processD2C(rows, st, null), [rows, st]);
  const result = useMemo(() => (run ? processD2C(rows, st, run.web) : fileOnly), [rows, st, run, fileOnly]);

  const s: D2CState = {
    config,
    setConfig: async (c) => { setConfigState(c); await d2cApi.saveConfig(c); },
    snapshots, snapshot, rows,
    useSnapshot: async (id) => {
      const x = await d2cApi.getSnapshot(id);
      setSnapshot(x.meta); setRows(x.rows.map(fromTuple)); await loadRunFor(id, runs);
    },
    addSnapshot: (meta, t) => { setSnapshots((p) => [meta, ...p]); setSnapshot(meta); setRows(t.map(fromTuple)); setRun(null); },
    runs, run,
    addRun: (r) => {
      const meta: D2CRunMeta = { id: r.id, at: r.at, snapshotId: r.snapshotId, options: r.options, notFound: r.notFound, failed: r.failed, listed: r.listed };
      setRuns((p) => [meta, ...p]); setRun(r);
    },
    register,
    setRegister: async (r) => { setRegisterState(r); await d2cApi.saveRegister(r); },
    result, fileOnly,
    go: setPage,
  };

  const nav: [D2CPage, string][] = [
    ["campaigns", "Campaigns"], ["upload", "Upload stock file"], ["settings", "Settings"], ["check", "Website check"], ["history", "History"],
  ];

  return (
    <div className="shell">
      <aside className="nav">
        <div className="brand"><small>DIGIDARTS × D2C</small><h1>D2C Campaign Planner</h1></div>
        {switcher}
        {nav.map(([k, l]) => <button key={k} className={page === k ? "on" : ""} onClick={() => setPage(k)}>{l}</button>)}
      </aside>
      <main className="main">
        <div className="row muted" style={{ justifyContent: "flex-end", marginBottom: 8, fontSize: 13 }}>
          Stock file:&nbsp;<b style={{ color: "var(--ink)" }}>{snapshot ? `${snapshot.fileName} (${new Date(snapshot.uploadedAt).toLocaleString("en-IN")})` : "No upload yet"}</b>
          &nbsp;·&nbsp;Website check:&nbsp;<b style={{ color: "var(--ink)" }}>{run ? new Date(run.at).toLocaleString("en-IN") : "not run"}</b>
        </div>
        {err && <div className="alert bad">{err}</div>}
        {loading ? <p className="muted">Loading…</p> : (
          <>
            {page === "campaigns" && <D2CCampaignsPage s={s} />}
            {page === "upload" && <D2CUploadPage s={s} />}
            {page === "settings" && <D2CSettingsPage s={s} />}
            {page === "check" && <D2CCheckPage s={s} />}
            {page === "history" && <D2CHistoryPage s={s} />}
          </>
        )}
      </main>
    </div>
  );
}
