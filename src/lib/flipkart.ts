export interface SizeInfo { label: string; pid: string; inStock: boolean }

const normSize = (v: string) => { const m = v.match(/\d+(\.\d+)?/); return m ? String(parseFloat(m[0])) : v.trim(); };
const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** Parse size swatches from a Flipkart product page HTML. */
export function parseSizes(html: string, itemId: string): SizeInfo[] {
  const item = itemId.toLowerCase();
  const out = new Map<string, SizeInfo>();
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const hrefM = m[1].match(/href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i);
    if (!hrefM) continue;
    const href = decode(hrefM[1] ?? hrefM[2] ?? "");
    if (!href.includes("swatchAttr=size") || !href.toLowerCase().includes(item)) continue;
    const pid = href.match(/[?&]pid=([A-Z0-9]+)/i)?.[1];
    if (!pid || out.has(pid)) continue;
    const inner = m[2];
    const text = decode(inner.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
    if (!/\d/.test(text)) continue;
    const label = normSize(text);
    const oos = /#707070/i.test(inner) || /rgb\(\s*112\s*,\s*112\s*,\s*112\s*\)/i.test(inner);
    out.set(pid, { label, pid, inStock: !oos });
  }
  if (out.size) return [...out.values()];
  // Fallback: some pages render size swatches without links (grey #707070 = out of stock, #333333 = in stock).
  const fb = new Map<string, SizeInfo>();
  const re2 = /<div\b[^>]*style="[^"]*?color:\s*(#[0-9a-fA-F]{6,8})[^"]*"[^>]*>\s*(\d{1,2}(?:\.5)?)\s*<\/div>/g;
  while ((m = re2.exec(html))) {
    const c = m[1].toLowerCase();
    if (!c.startsWith("#707070") && !c.startsWith("#333333")) continue;
    const label = normSize(m[2]);
    if (!fb.has(label)) fb.set(label, { label, pid: "", inStock: c.startsWith("#333333") });
  }
  return fb.size >= 2 ? [...fb.values()] : [];
}

export function looksBlocked(status: number, html: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  return /captcha|are you a human|access denied|request blocked|recaptcha/i.test(html.slice(0, 30000));
}
