import * as XLSX from "xlsx";
import JSZip from "jszip";
import type { CampaignResult, OutRow } from "./processing";

export const CSV_HEADER =
  "**** Instructions: This is a sample file. Please don't edit first 2 rows. Add FSN IDs from row 3 and only one per line. You can enter a maximum of 2000 FSN IDs ****";

export const safeName = (name: string) => name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export const prefixOf = (brand?: string) => (brand && brand.trim() ? `${safeName(brand)}_` : "");

export function buildCsvFiles(prefix: string, campaignName: string, fsns: string[]) {
  const unique = [...new Set(fsns)];
  const base = `${prefix}${safeName(campaignName)}`;
  const parts: string[][] = [];
  for (let i = 0; i < unique.length; i += 2000) parts.push(unique.slice(i, i + 2000));
  if (!parts.length) parts.push([]);
  return parts.map((p, i) => ({
    name: parts.length > 1 ? `${base}_part${i + 1}.csv` : `${base}.csv`,
    content: [CSV_HEADER, "FSN IDs", ...p].join("\n") + "\n",
  }));
}

export function download(name: string, data: BlobPart, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const rowOut = (r: OutRow) => ({
  model_name: r.model_name, article_number: r.article_number, inv_fsn: r.fsn, color: r.color,
  mrp_amount: r.mrp, qoh: r.qoh, uk_india_size: r.uk_size, final_size_fw: r.size,
  inv_vertical: r.vertical, core_sizes_available: r.core,
});

const sheetName = (n: string, used: Set<string>) => {
  let s = n.replace(/[\\/?*[\]:]/g, "-").slice(0, 31); let k = 2;
  while (used.has(s)) s = `${s.slice(0, 28)}_${k++}`;
  used.add(s); return s;
};

export function buildWorkbook(results: CampaignResult[], meta: string) {
  const wb = XLSX.utils.book_new();
  const summary = results.map((c) => ({
    Campaign: c.campaign.name, Gender: c.campaign.gender, Articles: c.articles.length, FSNs: c.rows.length,
    "Total QOH": c.totalQoh, Rules: c.campaign.rules.map((r) => `${r.vertical} (₹${r.mrp_from}–₹${r.mrp_to})`).join("; "),
  }));
  const ws = XLSX.utils.json_to_sheet(summary);
  XLSX.utils.sheet_add_aoa(ws, [[], [meta]], { origin: -1 });
  XLSX.utils.book_append_sheet(wb, ws, "Summary");
  const used = new Set(["Summary"]);
  for (const c of results) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(c.rows.map(rowOut)), sheetName(c.campaign.name, used));
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

export async function buildZip(prefix: string, results: CampaignResult[]) {
  const zip = new JSZip();
  for (const c of results) for (const f of buildCsvFiles(prefix, c.campaign.name, c.rows.map((r) => r.fsn))) zip.file(f.name, f.content);
  return zip.generateAsync({ type: "blob" });
}

export function sheetsToXlsx(sheets: Record<string, Record<string, unknown>[]>) {
  const wb = XLSX.utils.book_new(); const used = new Set<string>();
  for (const [name, rows] of Object.entries(sheets))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: "No rows" }]), sheetName(name, used));
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
