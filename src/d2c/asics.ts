/** asics.co.in (Magento) catalogue lookup — used in the browser and, as a fallback, in the Netlify function. */
export interface WebInfo {
  found: boolean;
  inStock: boolean;
  live: string[];      // in-stock size suffixes (same as the sku suffix in the file, e.g. "9", "10H")
  types: string[];     // category slugs under men|women/shoes/<type>
  final: number;
  regular: number;
  url: string;
}
export type WebMap = Record<string, WebInfo>;

export const ASICS_BATCH = 25;
const GQL = "https://www.asics.co.in/graphql";

const query = (opts: string[]) =>
  `{products(filter:{sku:{in:${JSON.stringify(opts)}}},pageSize:${opts.length + 5}){items{sku url_key url_suffix stock_status ` +
  `price_range{minimum_price{final_price{value} regular_price{value}}} categories{url_path} ` +
  `... on ConfigurableProduct{variants{product{sku stock_status}}}}}}`;

interface Item {
  sku: string; url_key: string; url_suffix?: string; stock_status: string;
  price_range?: { minimum_price?: { final_price?: { value: number | string }; regular_price?: { value: number | string } } };
  categories?: { url_path: string }[];
  variants?: { product: { sku: string; stock_status: string } }[];
}

/** Looks up up to ASICS_BATCH options (article codes like "1013A237.800"). Throws on network / HTTP errors. */
export async function fetchAsics(options: string[], f: typeof fetch = fetch): Promise<WebMap> {
  const res = await f(`${GQL}?query=${encodeURIComponent(query(options))}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`asics.co.in HTTP ${res.status}`);
  const j = (await res.json()) as { data?: { products?: { items?: Item[] } }; errors?: unknown };
  const items = j.data?.products?.items;
  if (!items) throw new Error(`asics.co.in: unexpected response ${JSON.stringify(j.errors ?? j).slice(0, 200)}`);
  const out: WebMap = {};
  for (const o of options) out[o] = { found: false, inStock: false, live: [], types: [], final: 0, regular: 0, url: "" };
  for (const it of items) {
    if (!(it.sku in out)) continue;
    const live = (it.variants ?? [])
      .filter((v) => v.product.stock_status === "IN_STOCK" && v.product.sku.startsWith(`${it.sku}.`))
      .map((v) => v.product.sku.slice(it.sku.length + 1));
    const types = [...new Set((it.categories ?? []).map((c) => /^(?:men|women)\/shoes\/([^/]+)$/.exec(c.url_path)?.[1]).filter(Boolean) as string[])];
    const mp = it.price_range?.minimum_price;
    out[it.sku] = {
      found: true, inStock: it.stock_status === "IN_STOCK", live, types,
      final: Number(mp?.final_price?.value ?? 0), regular: Number(mp?.regular_price?.value ?? 0),
      url: `https://www.asics.co.in/${it.url_key}${it.url_suffix ?? ".html"}`,
    };
  }
  return out;
}
