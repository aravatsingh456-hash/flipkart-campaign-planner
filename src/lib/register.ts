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
