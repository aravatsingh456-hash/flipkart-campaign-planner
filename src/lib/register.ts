import type { Run } from "./api";

/**
 * Pause register — remembers, per campaign + article, when the app asked to pause it
 * and when the user confirmed it was paused / resumed in Flipkart Ads.
 *
 *  To pause  → live check found fewer than the minimum sizes; waiting for the user to pause it in Flipkart
 *  Paused    → user confirmed it is paused in Flipkart (pausedOn)
 *  Resumed   → user confirmed it was switched back on (resumedOn); kept for history
 */
export type RegState = "To pause" | "Paused" | "Resumed";
export interface RegEntry {
  campaign: string; article: string; model: string; color: string;
  state: RegState;
  flaggedOn: string;            // first live check that said "pause"
  pausedOn?: string;            // user confirmed paused in Flipkart
  resumedOn?: string;           // user confirmed resumed in Flipkart
  liveSizes: string[];          // from the latest check
  latestStatus: "Active" | "Pause" | "Check failed";
  lastCheckedAt: string;
}
export type Register = Record<string, RegEntry>;

export const regKey = (campaign: string, article: string) => `${campaign}|${article}`;

export const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";

/** Apply a live check run to the register. */
export function applyRun(reg: Register, run: Run, checkedCampaigns: Set<string> | null): Register {
  const next: Register = { ...reg };
  for (const r of run.results) {
    if (checkedCampaigns && !checkedCampaigns.has(r.campaign)) continue; // carried-over results
    const k = regKey(r.campaign, r.article);
    const e = next[k];
    if (r.status === "Check failed") {
      if (e) next[k] = { ...e, latestStatus: "Check failed", lastCheckedAt: run.at };
      continue;
    }
    if (r.status === "Pause") {
      if (!e || e.state === "Resumed") {
        next[k] = { campaign: r.campaign, article: r.article, model: r.model, color: r.color, state: "To pause",
          flaggedOn: run.at, liveSizes: r.liveSizes, latestStatus: "Pause", lastCheckedAt: run.at };
      } else next[k] = { ...e, liveSizes: r.liveSizes, latestStatus: "Pause", lastCheckedAt: run.at };
    } else {
      // Active again
      if (!e) continue;
      if (e.state === "To pause") delete next[k];            // stock came back before it was paused — nothing to do
      else next[k] = { ...e, liveSizes: r.liveSizes, latestStatus: "Active", lastCheckedAt: run.at };
    }
  }
  return next;
}

export const toPause = (reg: Register) => Object.values(reg).filter((e) => e.state === "To pause");
export const paused = (reg: Register) => Object.values(reg).filter((e) => e.state === "Paused");
export const canResume = (reg: Register) => paused(reg).filter((e) => e.latestStatus === "Active");

/**
 * Old campaign name → new name, for campaigns that were renamed in Settings.
 * A campaign counts as renamed when its old name is gone and a new-named campaign has exactly the same rules
 * (or, failing that, sits at the same position in the list with the same gender).
 */
export function renameMap(before: { name: string; gender: string; rules: unknown[] }[], after: { name: string; gender: string; rules: unknown[] }[]) {
  const sig = (c: { gender: string; rules: unknown[] }) => `${c.gender}|${JSON.stringify(c.rules)}`;
  const oldNames = new Set(before.map((c) => c.name));
  const newNames = new Set(after.map((c) => c.name));
  const map = new Map<string, string>();
  for (const o of before) {
    if (newNames.has(o.name)) continue;
    const n = after.find((c) => !oldNames.has(c.name) && sig(c) === sig(o) && ![...map.values()].includes(c.name));
    if (n) map.set(o.name, n.name);
  }
  // second pass: rules were also edited — fall back to the same position in the list (same gender)
  before.forEach((o, i) => {
    if (newNames.has(o.name) || map.has(o.name)) return;
    const n = after[i];
    if (n && n.gender === o.gender && !oldNames.has(n.name) && ![...map.values()].includes(n.name)) map.set(o.name, n.name);
  });
  return map;
}

/** Moves register entries of renamed campaigns to the new name. */
export function renameInRegister(reg: Register, map: Map<string, string>): Register | null {
  if (!map.size) return null;
  let changed = false;
  const next: Register = {};
  for (const e of Object.values(reg)) {
    const name = map.get(e.campaign) ?? e.campaign;
    if (name !== e.campaign) changed = true;
    const k = regKey(name, e.article);
    const prev = next[k];
    // if both old and new entries exist, keep the one that is further along (paused > to pause)
    if (!prev || (prev.state === "To pause" && e.state !== "To pause")) next[k] = { ...e, campaign: name };
  }
  return changed ? next : null;
}

/** Applies renames to the campaign names inside a live check run (so statuses keep matching). */
export const renameInRun = <T extends { results: { campaign: string }[] }>(run: T, map: Map<string, string>): T =>
  map.size ? { ...run, results: run.results.map((r) => ({ ...r, campaign: map.get(r.campaign) ?? r.campaign })) } : run;
