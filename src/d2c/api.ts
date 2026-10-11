import type { D2CConfig, D2CRegister, D2CRun, D2CRunMeta, D2CTuple } from "./model";
import type { WebMap } from "./asics";

export interface D2CSnapMeta { id: string; fileName: string; uploadedAt: string; rowCount: number; sheet: string }

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/d2c/${path}`, { headers: { "content-type": "application/json" }, ...init });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const d2cApi = {
  getConfig: () => j<D2CConfig | null>("config"),
  saveConfig: (c: D2CConfig) => j<{ ok: true }>("config", { method: "PUT", body: JSON.stringify(c) }),
  listSnapshots: () => j<D2CSnapMeta[]>("snapshots"),
  getSnapshot: (id: string) => j<{ meta: D2CSnapMeta; rows: D2CTuple[] }>(`snapshots/${id}`),
  saveSnapshot: (meta: D2CSnapMeta, rows: D2CTuple[]) => j<{ ok: true }>("snapshots", { method: "POST", body: JSON.stringify({ meta, rows }) }),
  listRuns: () => j<D2CRunMeta[]>("runs"),
  getRun: (id: string) => j<D2CRun>(`runs/${id}`),
  saveRun: (run: D2CRun) => j<{ ok: true }>("runs", { method: "POST", body: JSON.stringify(run) }),
  getRegister: () => j<D2CRegister>("register"),
  saveRegister: (r: D2CRegister) => j<{ ok: true }>("register", { method: "PUT", body: JSON.stringify(r) }),
  clear: (what: "uploads" | "runs" | "settings" | "all", id?: string) =>
    j<{ ok: true; removed: number }>(`data?what=${what}${id ? `&id=${encodeURIComponent(id)}` : ""}`, { method: "DELETE" }),
  /** Server-side fallback for the website lookup. */
  check: (options: string[]) => j<WebMap>("check", { method: "POST", body: JSON.stringify({ options }) }),
};
