import type { Config } from "./defaults";
import type { InvTuple } from "./processing";
import type { Register } from "./register";
import type { CampaignReport, ReportMeta } from "./reports";

export interface SnapshotMeta { id: string; fileName: string; uploadedAt: string; rowCount: number }
export interface ArticleCheck {
  campaign: string; article: string; model: string; color: string;
  status: "Active" | "Pause" | "Check failed"; liveSizes: string[]; http?: number; error?: string;
  inStockFsn?: string; oosFsns: string[];
}
export interface RunMeta { id: string; at: string; snapshotId: string; scope: string; articles: number; failed: number }
export interface Run extends RunMeta { results: ArticleCheck[] }
export interface CheckReq { article: string; itemId: string; fsns: string[] }
export interface CheckRes { article: string; ok: boolean; http: number; error?: string; sizes: { label: string; pid: string; inStock: boolean }[] }

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/${path}`, { headers: { "content-type": "application/json" }, ...init });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  getConfig: () => j<Config | null>("config"),
  saveConfig: (c: Config) => j<{ ok: true }>("config", { method: "PUT", body: JSON.stringify(c) }),
  listSnapshots: () => j<SnapshotMeta[]>("snapshots"),
  getSnapshot: (id: string) => j<{ meta: SnapshotMeta; rows: InvTuple[] }>(`snapshots/${id}`),
  saveSnapshot: (meta: SnapshotMeta, rows: InvTuple[]) => j<{ ok: true }>("snapshots", { method: "POST", body: JSON.stringify({ meta, rows }) }),
  listRuns: () => j<RunMeta[]>("runs"),
  getRun: (id: string) => j<Run>(`runs/${id}`),
  saveRun: (run: Run) => j<{ ok: true }>("runs", { method: "POST", body: JSON.stringify(run) }),
  getRegister: () => j<Register>("register"),
  saveRegister: (r: Register) => j<{ ok: true }>("register", { method: "PUT", body: JSON.stringify(r) }),
  listReports: () => j<ReportMeta[]>("reports"),
  getReport: (id: string) => j<CampaignReport>(`reports/${id}`),
  saveReport: (report: CampaignReport, meta: ReportMeta) => j<{ ok: true }>(`reports/${report.id}`, { method: "PUT", body: JSON.stringify({ report, meta }) }),
  clear: (what: "uploads" | "runs" | "settings" | "reports" | "all", id?: string) =>
    j<{ ok: true; removed: number }>(`data?what=${what}${id ? `&id=${encodeURIComponent(id)}` : ""}`, { method: "DELETE" }),
  check: (items: CheckReq[]) => j<CheckRes[]>("check", { method: "POST", body: JSON.stringify({ items }) }),
};
