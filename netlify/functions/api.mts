import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { parseSizes, looksBlocked } from "../../src/lib/flipkart";
import { fetchAsics } from "../../src/d2c/asics";

export const config: Config = { path: "/api/*" };

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
const store = () => getStore({ name: "campaign-planner", consistency: "strong" });

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function checkOne(it: { article: string; itemId: string; fsns: string[] }) {
  let last = { article: it.article, ok: false, http: 0, error: "No size links found", sizes: [] as ReturnType<typeof parseSizes> };
  for (const fsn of it.fsns.slice(0, 2)) {
    try {
      await sleep(150 + Math.random() * 350);
      const url = `https://www.flipkart.com/x/p/${it.itemId.toLowerCase()}?pid=${fsn}`;
      const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en-IN,en;q=0.9", accept: "text/html,application/xhtml+xml" }, redirect: "follow" });
      const html = await res.text();
      if (looksBlocked(res.status, html)) { last = { ...last, http: res.status, error: "Blocked by Flipkart", sizes: [] }; break; }
      const sizes = parseSizes(html, it.itemId);
      if (sizes.length) return { article: it.article, ok: true, http: res.status, sizes };
      last = { ...last, http: res.status, error: res.ok ? "No size links found" : `HTTP ${res.status}` };
    } catch (e) {
      last = { ...last, error: String(e) };
    }
  }
  return last;
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  let parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  // "/api/d2c/..." uses the same routes with every key under "d2c/" so Flipkart and D2C data never mix
  const P = parts[0] === "d2c" ? "d2c/" : "";
  if (P) parts = parts.slice(1);
  const s = store();
  try {
    if (parts[0] === "config") {
      if (req.method === "GET") return json((await s.get(`${P}config`, { type: "json" })) ?? null);
      if (req.method === "PUT") { await s.setJSON(`${P}config`, await req.json()); return json({ ok: true }); }
    }
    if (parts[0] === "snapshots") {
      if (req.method === "GET" && parts[1]) {
        const d = await s.get(`${P}snap/${parts[1]}`, { type: "json" });
        return d ? json(d) : json({ error: "not found" }, 404);
      }
      if (req.method === "GET") return json(((await s.get(`${P}snap-index`, { type: "json" })) as unknown[]) ?? []);
      if (req.method === "POST") {
        const body = (await req.json()) as { meta: { id: string } };
        await s.setJSON(`${P}snap/${body.meta.id}`, body);
        const idx = ((await s.get(`${P}snap-index`, { type: "json" })) as unknown[]) ?? [];
        await s.setJSON(`${P}snap-index`, [body.meta, ...idx].slice(0, 100));
        return json({ ok: true });
      }
    }
    if (parts[0] === "runs") {
      if (req.method === "GET" && parts[1]) {
        const d = await s.get(`${P}run/${parts[1]}`, { type: "json" });
        return d ? json(d) : json({ error: "not found" }, 404);
      }
      if (req.method === "GET") return json(((await s.get(`${P}run-index`, { type: "json" })) as unknown[]) ?? []);
      if (req.method === "POST") {
        const run = (await req.json()) as Record<string, unknown> & { id: string };
        await s.setJSON(`${P}run/${run.id}`, run);
        // index keeps only the small fields (no results / web data)
        const meta = Object.fromEntries(Object.entries(run).filter(([, v]) => v === null || typeof v !== "object"));
        const idx = ((await s.get(`${P}run-index`, { type: "json" })) as unknown[]) ?? [];
        await s.setJSON(`${P}run-index`, [meta, ...idx].slice(0, 300));
        return json({ ok: true });
      }
    }
    if (parts[0] === "reports") {
      if (req.method === "GET" && parts[1]) {
        const d = await s.get(`${P}report/${parts[1]}`, { type: "json" });
        return d ? json(d) : json({ error: "not found" }, 404);
      }
      if (req.method === "GET") return json(((await s.get(`${P}report-index`, { type: "json" })) as unknown[]) ?? []);
      if (req.method === "PUT" && parts[1]) {
        const body = (await req.json()) as { report: { id: string }; meta: { id: string } };
        await s.setJSON(`${P}report/${parts[1]}`, body.report);
        const idx = (((await s.get(`${P}report-index`, { type: "json" })) as { id: string }[]) ?? []).filter((x) => x.id !== parts[1]);
        await s.setJSON(`${P}report-index`, [body.meta, ...idx]);
        return json({ ok: true });
      }
    }
    if (parts[0] === "register") {
      if (req.method === "GET") return json((await s.get(`${P}register`, { type: "json" })) ?? {});
      if (req.method === "PUT") { await s.setJSON(`${P}register`, await req.json()); return json({ ok: true }); }
    }
    if (parts[0] === "data" && req.method === "DELETE") {
      // what = uploads | runs | settings | all ; optional id deletes a single upload/run
      const what = url.searchParams.get("what") ?? "";
      const id = url.searchParams.get("id");
      const removeAll = async (prefix: string) => {
        const { blobs } = await s.list({ prefix });
        await Promise.all(blobs.map((b) => s.delete(b.key)));
        return blobs.length;
      };
      const dropFromIndex = async (key: string, rid: string) => {
        const idx = ((await s.get(key, { type: "json" })) as { id: string }[]) ?? [];
        await s.setJSON(key, idx.filter((x) => x.id !== rid));
      };
      let removed = 0;
      if (what === "uploads" && id) { await s.delete(`${P}snap/${id}`); await dropFromIndex(`${P}snap-index`, id); removed = 1; }
      else if (what === "reports" && id) { await s.delete(`${P}report/${id}`); await dropFromIndex(`${P}report-index`, id); removed = 1; }
      else if (what === "runs" && id) { await s.delete(`${P}run/${id}`); await dropFromIndex(`${P}run-index`, id); removed = 1; }
      else {
        if (what === "uploads" || what === "all") { removed += await removeAll(`${P}snap/`); await s.delete(`${P}snap-index`); }
        if (what === "runs" || what === "all") { removed += await removeAll(`${P}run/`); await s.delete(`${P}run-index`); await s.delete(`${P}register`); }
        if (what === "reports" || what === "all") { removed += await removeAll(`${P}report/`); await s.delete(`${P}report-index`); }
        if (what === "settings" || what === "all") { await s.delete(`${P}config`); removed += 1; }
      }
      return json({ ok: true, removed });
    }
    if (P && parts[0] === "check" && req.method === "POST") {
      const { options } = (await req.json()) as { options: string[] };
      return json(await fetchAsics(options.slice(0, 50)));
    }
    if (parts[0] === "check" && req.method === "POST") {
      const { items } = (await req.json()) as { items: { article: string; itemId: string; fsns: string[] }[] };
      const out: Awaited<ReturnType<typeof checkOne>>[] = [];
      for (let i = 0; i < items.length; i += 4) out.push(...(await Promise.all(items.slice(i, i + 4).map(checkOne))));
      return json(out);
    }
    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};
