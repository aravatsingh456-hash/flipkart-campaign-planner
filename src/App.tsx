import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_CONFIG, type Config } from "./lib/defaults";
import { fromTuple, processInventory, type InvRow } from "./lib/processing";
import { api, type Run, type RunMeta, type SnapshotMeta } from "./lib/api";
import { renameInRegister, renameInRun, renameMap, type Register } from "./lib/register";
import UploadPage from "./pages/Upload";
import SettingsPage from "./pages/Settings";
import CampaignsPage from "./pages/Campaigns";
import LiveCheckPage from "./pages/LiveCheck";
import HistoryPage from "./pages/History";
import ReportsPage from "./pages/Reports";

export type Page = "campaigns" | "upload" | "settings" | "live" | "reports" | "history";

export interface AppState {
  config: Config;
  setConfig: (c: Config) => Promise<void>;
  snapshots: SnapshotMeta[];
  snapshot: SnapshotMeta | null;
  rows: InvRow[];
  useSnapshot: (id: string) => Promise<void>;
  addSnapshot: (meta: SnapshotMeta, rows: InvRow[]) => void;
  runs: RunMeta[];
  latestRun: Run | null;
  addRun: (run: Run) => void;
  register: Register;
  setRegister: (r: Register) => Promise<void>;
  go: (p: Page) => void;
}

export default function App({ switcher }: { switcher?: ReactNode }) {
  const [page, setPage] = useState<Page>("campaigns");
  const [config, setConfigState] = useState<Config>(DEFAULT_CONFIG);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [snapshot, setSnapshot] = useState<SnapshotMeta | null>(null);
  const [rows, setRows] = useState<InvRow[]>([]);
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [latestRun, setLatestRun] = useState<Run | null>(null);
  const [register, setRegisterState] = useState<Register>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    document.title = "Flipkart Campaign Planner";
    (async () => {
      try {
        const [cfg, snaps, rs, reg] = await Promise.all([api.getConfig(), api.listSnapshots(), api.listRuns(), api.getRegister().catch(() => ({}))]);
        // campaigns renamed in Settings before renames were tracked: map the default names to the renamed ones
        const fix = cfg ? renameMap(DEFAULT_CONFIG.campaigns, cfg.campaigns) : new Map<string, string>();
        const migrated = renameInRegister(reg ?? {}, fix);
        if (migrated) await api.saveRegister(migrated);
        setRegisterState(migrated ?? reg ?? {});
        if (cfg) setConfigState({ ...cfg, settings: { ...DEFAULT_CONFIG.settings, ...cfg.settings } });
        setSnapshots(snaps);
        setRuns(rs);
        if (snaps[0]) {
          const s = await api.getSnapshot(snaps[0].id);
          setSnapshot(s.meta);
          setRows(s.rows.map(fromTuple));
        }
        if (rs[0]) setLatestRun(renameInRun(await api.getRun(rs[0].id), fix));
      } catch (e) {
        setErr(`Could not load saved data: ${String(e)}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const state: AppState = {
    config,
    setConfig: async (c) => {
      // keep the pause register, the latest live check and linked campaign reports on the new names
      const map = renameMap(config.campaigns, c.campaigns);
      setConfigState(c); await api.saveConfig(c);
      if (!map.size) return;
      const reg = renameInRegister(register, map);
      if (reg) { setRegisterState(reg); await api.saveRegister(reg); }
      if (latestRun) setLatestRun(renameInRun(latestRun, map));
      const metas = await api.listReports().catch(() => []);
      for (const m of metas) if (m.planner && map.has(m.planner)) {
        const r = await api.getReport(m.id);
        const next = { ...r, planner: map.get(m.planner)! };
        const { rows: _r, check: _c, ...rest } = next;
        await api.saveReport(next, { ...m, ...rest, planner: next.planner });
      }
    },
    snapshots,
    snapshot,
    rows,
    useSnapshot: async (id) => {
      const s = await api.getSnapshot(id);
      setSnapshot(s.meta);
      setRows(s.rows.map(fromTuple));
    },
    addSnapshot: (meta, r) => { setSnapshots((p) => [meta, ...p]); setSnapshot(meta); setRows(r); },
    runs,
    latestRun,
    addRun: (run) => {
      const { results: _r, ...meta } = run;
      setRuns((p) => [meta, ...p]);
      setLatestRun(run);
    },
    register,
    setRegister: async (r) => { setRegisterState(r); await api.saveRegister(r); },
    go: setPage,
  };

  const result = useMemo(() => processInventory(rows, config.campaigns, config.settings), [rows, config]);

  const nav: [Page, string][] = [
    ["campaigns", "Campaigns"], ["upload", "Upload inventory"], ["settings", "Settings"], ["live", "Live check"], ["reports", "Campaign reports"], ["history", "History"],
  ];

  return (
    <div className="shell">
      <aside className="nav">
        <div className="brand"><small>DIGIDARTS × FLIPKART</small><h1>Flipkart Campaign Planner</h1></div>
        {switcher}
        {nav.map(([k, l]) => (
          <button key={k} className={page === k ? "on" : ""} onClick={() => setPage(k)}>{l}</button>
        ))}
      </aside>
      <main className="main">
        <div className="row muted" style={{ justifyContent: "flex-end", marginBottom: 8, fontSize: 13 }}>
          Inventory base:&nbsp;<b style={{ color: "var(--ink)" }}>{snapshot ? `${snapshot.fileName} (${new Date(snapshot.uploadedAt).toLocaleString("en-IN")})` : "No upload yet"}</b>
        </div>
        {err && <div className="alert bad">{err}</div>}
        {loading ? <p className="muted">Loading…</p> : (
          <>
            {page === "campaigns" && <CampaignsPage s={state} result={result} />}
            {page === "upload" && <UploadPage s={state} />}
            {page === "settings" && <SettingsPage s={state} />}
            {page === "live" && <LiveCheckPage s={state} result={result} />}
            {page === "reports" && <ReportsPage s={state} />}
            {page === "history" && <HistoryPage s={state} />}
          </>
        )}
      </main>
    </div>
  );
}
