import type { Workbook, Worksheet, Fill, Font, Borders } from "exceljs";
import { fmtDate, sortSizes, type Article, type D2CCampaign, type D2CRegEntry, type D2CResult, type D2CSettings, type Group } from "./model";

const load = async () => (await import("exceljs")).default;
const A = "Arial";
const HDR: Record<Group, string> = { Discounted: "FF7B2C2C", "Non-discounted": "FF1F3864" };
const fill = (argb: string): Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const ALT = fill("FFF2F2F2");
const thin = { style: "thin" as const, color: { argb: "FFBFBFBF" } };
const BD: Partial<Borders> = { top: thin, bottom: thin, left: thin, right: thin };
const F: Partial<Font> = { name: A, size: 10 };
const UNI: Partial<Font> = { name: A, size: 10, bold: true, color: { argb: "FFC55A11" } };
const HF: Partial<Font> = { name: A, size: 10, bold: true, color: { argb: "FFFFFFFF" } };

type Col = { h: string; w: number; v: (a: Article, s: { size: string; soh: number; sku: string }) => unknown; fmt?: string };
const COLS: Col[] = [
  { h: "Campaign", w: 22, v: (a) => a.campaign },
  { h: "sku", w: 18, v: (_, s) => s.sku },
  { h: "Product Name", w: 20, v: (a) => a.name },
  { h: "Option", w: 15, v: (a) => a.option },
  { h: "Category", w: 9, v: (a) => a.category },
  { h: "Gender (Men / Women / Unisex)", w: 13, v: (a) => a.gender },
  { h: "Shoe type (website)", w: 26, v: (a) => a.type },
  { h: "Legends/Non-Legends", w: 13, v: (a) => a.legends },
  { h: "Season", w: 11, v: (a) => a.season },
  { h: "MRP", w: 9, v: (a) => a.mrp, fmt: '"₹"#,##0' },
  { h: "Discount %", w: 10, v: (a) => a.disc, fmt: "0%" },
  { h: "Sale price", w: 10, v: (a) => a.sale, fmt: '"₹"#,##0' },
  { h: "AOV", w: 10, v: (a) => a.aov },
  { h: "Size", w: 6, v: (_, s) => s.size },
  { h: "SOH", w: 8, v: (_, s) => s.soh, fmt: "#,##0" },
  { h: "Live sizes on website", w: 30, v: (a) => sortSizes(a.web?.live ?? []).join(", ") },
  { h: "Website price", w: 11, v: (a) => a.web?.final ?? "", fmt: '"₹"#,##0' },
  { h: "Product URL", w: 48, v: (a) => a.web?.url ?? "" },
];

function header(ws: Worksheet, row: number, col: number, heads: { h: string; w: number }[], color: string) {
  heads.forEach((c, j) => {
    const cell = ws.getCell(row, col + j);
    cell.value = c.h; cell.font = HF; cell.fill = fill(color); cell.border = BD;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    ws.getColumn(col + j).width = c.w;
  });
  ws.getRow(row).height = 30;
}
const sheetTitle = (s: string) => s.replace(/[\\/?*[\]:]/g, "-").slice(0, 31);
const buf = async (wb: Workbook) => (await wb.xlsx.writeBuffer()) as ArrayBuffer;

/** Detailed sheet: Summary + one tab per campaign (one row per size) + Not included. */
export async function buildDetailed(group: Group, res: D2CResult, st: D2CSettings, source: string, checkedAt: string) {
  const ExcelJS = await load();
  const wb = new ExcelJS.Workbook();
  const color = HDR[group];
  const sm = wb.addWorksheet("Summary");
  const camps = res.campaigns.filter((c) => c.group === group);
  const info: { c: D2CCampaign; skus: number; soh: number; uni: number }[] = [];
  for (const c of camps) {
    const skus = c.articles.reduce((s, a) => s + a.rows.length, 0);
    const soh = c.articles.reduce((s, a) => s + a.rows.reduce((t, x) => t + x.soh, 0), 0);
    info.push({ c, skus, soh, uni: c.articles.filter((a) => a.gender === "Unisex").length });
    if (!c.articles.length) continue;
    const ws = wb.addWorksheet(sheetTitle(c.name), { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
    header(ws, 1, 1, COLS, color);
    let r = 2, shade = false;
    for (const a of c.articles) {
      shade = !shade;
      for (const s of a.rows) {
        COLS.forEach((col, j) => {
          const cell = ws.getCell(r, j + 1);
          cell.value = col.v(a, s) as never; cell.font = j === 5 && a.gender === "Unisex" ? UNI : F; cell.border = BD;
          if (col.fmt) cell.numFmt = col.fmt;
          if (shade) cell.fill = ALT;
        });
        r++;
      }
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: r - 1, column: COLS.length } };
  }
  // Summary
  sm.getColumn(1).width = 3; sm.getColumn(2).width = 26;
  [16, 14, 10, 12, 18].forEach((w, i) => (sm.getColumn(3 + i).width = w));
  sm.getCell("B2").value = `${st.brand ? st.brand + " " : ""}D2C – ${group} products (Meta / Google campaign list)`;
  sm.getCell("B2").font = { name: A, bold: true, size: 14 };
  sm.getCell("B3").value = `Source: ${source} · website check: ${checkedAt}`;
  sm.getCell("B3").font = { name: A, italic: true, color: { argb: "FF595959" } };
  header(sm, 5, 2, ["Campaign", "Articles (Option)", "of which Unisex", "SKUs", "Total SOH", "Sale price rule"].map((h) => ({ h, w: sm.getColumn(2).width ?? 14 })), color);
  sm.getColumn(2).width = 26; [16, 14, 10, 12, 18].forEach((w, i) => (sm.getColumn(3 + i).width = w));
  let r = 6;
  for (const x of info) {
    const th = st.categories.find((k) => k.code === x.c.category)?.high_from ?? 0;
    [x.c.name, x.c.articles.length, x.uni, x.skus, x.soh, `${x.c.aov === "High AOV" ? "≥" : "<"} ₹${th.toLocaleString("en-IN")}`].forEach((v, j) => {
      const cell = sm.getCell(r, 2 + j); cell.value = v; cell.font = F; cell.border = BD; if (j === 4) cell.numFmt = "#,##0";
    });
    r++;
  }
  const tot = (k: "articles" | "uni" | "skus" | "soh") => info.reduce((s, x) => s + (k === "articles" ? x.c.articles.length : x[k]), 0);
  ["Total", tot("articles"), tot("uni"), tot("skus"), tot("soh")].forEach((v, j) => {
    const cell = sm.getCell(r, 2 + j); cell.value = v; cell.font = { ...F, bold: true }; cell.border = BD; cell.numFmt = "#,##0";
  });
  r += 2;
  const cut = st.categories.map((c) => `${c.code} High ≥ ₹${c.high_from.toLocaleString("en-IN")}`).join(" · ");
  const notes = [
    "Rules applied:",
    `• ${group} = discount ${group === "Non-discounted" ? "= 0%" : "> 0%"}. Categories: ${st.categories.map((c) => `${c.code} (${c.label})`).join(", ")}. Kids sizes excluded.`,
    st.include_unisex ? "• Unisex products are in BOTH Men and Women campaigns. The Gender column shows Men / Women / Unisex (Unisex in orange)." : "• Unisex products are not included.",
    `• Sale price = MRP × (1 − discount). AOV split on sale price: ${cut}.`,
    "• Size = last part of the sku after the final dot (as in the file). Article = Option.",
    `• Men campaigns: core sizes ${st.men_core.join(", ")} must ALL have SOH ≥ ${st.min_soh} AND be in stock on the website.`,
    `• Women campaigns: any ${st.women_min_sizes} or more sizes with SOH ≥ ${st.min_soh} that are also in stock on the website.`,
    `• Listed rows = sizes with SOH ≥ ${st.min_soh} that are in stock on the website. "Shoe type" comes from the product's category on the website.`,
    '• See tab "Not included" for articles that passed the file rule but failed the website check.',
  ];
  for (const t of notes) { const c = sm.getCell(r++, 2); c.value = t; c.font = t.endsWith(":") ? { ...F, bold: true } : F; }
  // Not included
  const ex = wb.addWorksheet("Not included", { views: [{ state: "frozen", ySplit: 1 }] });
  const ec = [{ h: "Campaign gender", w: 10 }, { h: "Category", w: 10 }, { h: "Option", w: 16 }, { h: "Product Name", w: 22 }, { h: "Gender (file)", w: 12 }, { h: "Discount %", w: 10 }, { h: "Reason", w: 56 }];
  header(ex, 1, 1, ec, color);
  const exc = res.articles.filter((a) => a.group === group && a.status !== "Listed").sort((a, b) => a.cg.localeCompare(b.cg) || a.category.localeCompare(b.category) || a.option.localeCompare(b.option));
  exc.forEach((a, i) => [a.cg, a.category, a.option, a.name, a.gender, a.disc, a.reason].forEach((v, j) => {
    const c = ex.getCell(i + 2, j + 1); c.value = v; c.font = F; c.border = BD; if (j === 5) c.numFmt = "0%";
  }));
  if (!exc.length) ex.getCell(2, 1).value = "None";
  return buf(wb);
}

type IdCol = { h: string; w: number; k: "name" | "option" | "sku" | "gender" | "url" };
const META: IdCol[] = [{ h: "Product Name", w: 24, k: "name" }, { h: "Option", w: 15, k: "option" }, { h: "Gender", w: 10, k: "gender" }, { h: "Product URL", w: 48, k: "url" }];
const GOOG: IdCol[] = [{ h: "Product Name", w: 24, k: "name" }, { h: "Option", w: 15, k: "option" }, { h: "sku", w: 18, k: "sku" }, { h: "Gender", w: 10, k: "gender" }, { h: "Product URL", w: 48, k: "url" }];
interface IdRow { name: string; option: string; sku: string; gender: string; url: string }

function idTable(ws: Worksheet, col: number, title: string, cols: IdCol[], rows: IdRow[], color: string) {
  const t = ws.getCell(1, col); t.value = title; t.font = { name: A, bold: true, size: 12 };
  header(ws, 2, col, cols, color);
  let prev = "", shade = false;
  rows.forEach((r, i) => {
    if (r.option !== prev) { shade = !shade; prev = r.option; }
    cols.forEach((c, j) => {
      const cell = ws.getCell(i + 3, col + j); cell.value = r[c.k]; cell.border = BD;
      cell.font = c.k === "gender" && r.gender === "Unisex" ? UNI : F; if (shade) cell.fill = ALT;
    });
  });
}
function idSheet(wb: Workbook, title: string, meta: IdRow[], goog: IdRow[], color: string, metaTitle: string, googTitle: string) {
  const ws = wb.addWorksheet(sheetTitle(title), { views: [{ state: "frozen", ySplit: 2 }] });
  idTable(ws, 1, metaTitle, META, meta, color);
  ws.getColumn(META.length + 1).width = 4;
  idTable(ws, META.length + 2, googTitle, GOOG, goog, color);
}

/** ID sheet: one tab per campaign, Meta (Option) table on the left, Google (sku) table on the right. */
export async function buildIds(group: Group, res: D2CResult) {
  const ExcelJS = await load();
  const wb = new ExcelJS.Workbook();
  for (const c of res.campaigns.filter((x) => x.group === group && x.articles.length)) {
    const meta = c.articles.map((a) => ({ name: a.name, option: a.option, sku: "", gender: a.gender, url: a.web?.url ?? "" }));
    const goog = c.articles.flatMap((a) => a.rows.map((s) => ({ name: a.name, option: a.option, sku: s.sku, gender: a.gender, url: a.web?.url ?? "" })));
    idSheet(wb, c.name, meta, goog, HDR[group], `Meta – product set (Option) · ${meta.length} options`, `Google – product list (sku) · ${goog.length} SKUs`);
  }
  if (!wb.worksheets.length) wb.addWorksheet("No products").getCell(1, 1).value = "No products in this group.";
  return buf(wb);
}

/** Pause / resume list: per tab Meta (Option) + Google (sku), with campaign and dates. */
export async function buildRegisterFile(kind: "pause" | "resume", entries: D2CRegEntry[], res: D2CResult | null) {
  const ExcelJS = await load();
  const wb = new ExcelJS.Workbook();
  const color = kind === "pause" ? "FFB42318" : "FF157F3B";
  const ws = wb.addWorksheet(kind === "pause" ? "To pause" : "Can resume", { views: [{ state: "frozen", ySplit: 2 }] });
  const byKey = new Map((res?.articles ?? []).map((a) => [a.key, a]));
  const head = [{ h: "Campaign", w: 22 }, { h: "Group", w: 14 }, { h: "Product Name", w: 22 }, { h: "Option", w: 15 }, { h: "Gender", w: 10 },
    { h: kind === "pause" ? "Flagged on" : "Paused on", w: 13 }, { h: kind === "pause" ? "Reason" : "Live sizes now", w: 40 }];
  const gHead = [{ h: "Campaign", w: 22 }, { h: "Option", w: 15 }, { h: "sku", w: 18 }];
  const t1 = ws.getCell(1, 1); t1.value = `Meta – product set (Option) · ${entries.length}`; t1.font = { name: A, bold: true, size: 12 };
  header(ws, 2, 1, head, color);
  entries.forEach((e, i) => {
    const a = byKey.get(e.key);
    const vals = [a?.campaign ?? e.campaign, a?.group ?? e.group ?? "", e.name, e.option, e.gender,
      fmtDate(kind === "pause" ? e.flaggedOn : e.pausedOn), kind === "pause" ? e.reason : sortSizes(a?.rows.map((x) => x.size) ?? []).join(", ")];
    vals.forEach((v, j) => { const c = ws.getCell(i + 3, j + 1); c.value = v; c.font = F; c.border = BD; });
  });
  const gc = head.length + 2;
  ws.getColumn(head.length + 1).width = 4;
  const gRows = entries.flatMap((e) => {
    const a = byKey.get(e.key);
    const skus = kind === "resume" && a ? a.rows.map((x) => x.sku) : e.skus;
    return skus.map((sku) => [a?.campaign ?? e.campaign, e.option, sku]);
  });
  const t2 = ws.getCell(1, gc); t2.value = `Google – product list (sku) · ${gRows.length}`; t2.font = { name: A, bold: true, size: 12 };
  header(ws, 2, gc, gHead, color);
  gRows.forEach((r, i) => r.forEach((v, j) => { const c = ws.getCell(i + 3, gc + j); c.value = v; c.font = F; c.border = BD; }));
  return buf(wb);
}
