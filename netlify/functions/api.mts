import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { parseSizes, looksBlocked } from "../../src/lib/flipkart";

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
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const s = store();
  try {
    if (parts[0] === "config") {
      if (req.method === "GET") return json((await s.get("config", { type: "json" })) ?? null);
      if (req.method === "PUT") { await s.setJSON("config", await req.json()); return json({ ok: true }); }
    }
    if (parts[0] === "snapshots") {
      if (req.method === "GET" && parts[1]) {
        const d = await s.get(`snap/${parts[1]}`, { type: "json" });
        return d ? json(d) : json({ error: "not found" }, 404);
      }
      if (req.method === "GET") return json(((await s.get("snap-index", { type: "json" })) as unknown[]) ?? []);
      if (req.method === "POST") {
        const body = (await req.json()) as { meta: { id: string } };
        await s.setJSON(`snap/${body.meta.id}`, body);
        const idx = ((await s.get("snap-index", { type: "json" })) as unknown[]) ?? [];
        await s.setJSON("snap-index", [body.meta, ...idx].slice(0, 100));
        return json({ ok: true });
      }
    }
    if (parts[0] === "runs") {
      if (req.method === "GET" && parts[1]) {
        const d = await s.get(`run/${parts[1]}`, { type: "json" });
        return d ? json(d) : json({ error: "not found" }, 404);
      }
      if (req.method === "GET") return json(((await s.get("run-index", { type: "json" })) as unknown[]) ?? []);
      if (req.method === "POST") {
        const run = (await req.json()) as { id: string; at: string; snapshotId: string; scope: string; articles: number; failed: number };
        await s.setJSON(`run/${run.id}`, run);
        const { id, at, snapshotId, scope, articles, failed } = run;
        const idx = ((await s.get("run-index", { type: "json" })) as unknown[]) ?? [];
        await s.setJSON("run-index", [{ id, at, snapshotId, scope, articles, failed }, ...idx].slice(0, 300));
        return json({ ok: true });
      }
    }
    if (parts[0] === "register") {
      if (req.method === "GET") return json((await s.get("register", { type: "json" })) ?? {});
      if (req.method === "PUT") { await s.setJSON("register", await req.json()); return json({ ok: true }); }
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
      if (what === "uploads" && id) { await s.delete(`snap/${id}`); await dropFromIndex("snap-index", id); removed = 1; }
      else if (what === "runs" && id) { await s.delete(`run/${id}`); await dropFromIndex("run-index", id); removed = 1; }
      else {
        if (what === "uploads" || what === "all") { removed += await removeAll("snap/"); await s.delete("snap-index"); }
        if (what === "runs" || what === "all") { removed += await removeAll("run/"); await s.delete("run-index"); await s.delete("register"); }
        if (what === "settings" || what === "all") { await s.delete("config"); removed += 1; }
      }
      return json({ ok: true, removed });
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
