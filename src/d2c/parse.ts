import * as XLSX from "xlsx";
import type { D2CSettings, D2CTuple } from "./model";

export const D2C_REQUIRED = ["sku", "Product Name", "Option", "Category", "Gender", "MRP", "SOH", "Discount %"] as const;

const str = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[₹,%\s]/g, "")); return Number.isFinite(n) ? n : 0; };
const norm = (s: unknown) => str(s).toLowerCase().replace(/[^a-z0-9%]/g, "");

/** Finds the sheet + header row that holds sku / Option / SOH, then returns rows of the footwear categories in settings. */
export function parseD2C(book: XLSX.WorkBook, st: D2CSettings): { tuples: D2CTuple[]; sheet: string; error?: string; total: number } {
  for (const sheet of book.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheet], { header: 1, defval: null, raw: true });
    const hi = aoa.slice(0, 15).findIndex((r) => {
      const n = (r ?? []).map(norm);
      return n.includes("sku") && n.includes("option") && n.includes("soh");
    });
    if (hi < 0) continue;
    const h = (aoa[hi] ?? []).map(norm);
    const col = (...names: string[]) => h.findIndex((x) => names.includes(x));
    const c = {
      sku: col("sku"), name: col("productname", "name"), option: col("option"), cat: col("category"), gender: col("gender"),
      legends: col("legendsnonlegends", "legends"), season: col("season"), mrp: col("mrp"), soh: col("soh"),
      disc: h.findIndex((x) => x.includes("discount")),
    };
    const missing = Object.entries({ sku: c.sku, "Product Name": c.name, Option: c.option, Category: c.cat, Gender: c.gender, MRP: c.mrp, SOH: c.soh, "Discount %": c.disc })
      .filter(([, i]) => i < 0).map(([k]) => k);
    if (missing.length) return { tuples: [], sheet, total: 0, error: `Missing columns in sheet "${sheet}": ${missing.join(", ")}` };
    const cats = new Set(st.categories.map((x) => x.code));
    const body = aoa.slice(hi + 1).filter((r) => r && str(r[c.sku]) && str(r[c.option]));
    const tuples: D2CTuple[] = [];
    for (const r of body) {
      const soh = num(r[c.soh]);
      const cat = str(r[c.cat]).toUpperCase();
      if (soh <= 0 || !cats.has(cat)) continue;
      let d = num(r[c.disc]); if (d > 1) d /= 100;
      tuples.push([str(r[c.sku]), str(r[c.name]), str(r[c.option]), cat, str(r[c.gender]),
        c.legends >= 0 ? str(r[c.legends]) : "", c.season >= 0 ? str(r[c.season]) : "", num(r[c.mrp]), soh, d]);
    }
    return { tuples, sheet, total: body.length };
  }
  return { tuples: [], sheet: "", total: 0, error: "Could not find a sheet with the columns sku, Option and SOH." };
}
