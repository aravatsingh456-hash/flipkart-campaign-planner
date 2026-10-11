# Flipkart Campaign Planner

A small web app for planning Flipkart Ads (Product Listing Ads) campaigns from a brand's inventory file.

## What it does
1. **Upload inventory** – upload the QOH Excel (sheet `QOH`). Required columns: `inv_fsn, item_id, inv_super_category, inv_vertical, model_name, article_number, color, mrp_amount, qoh, uk_india_size, final_size_fw`.
2. **Settings** – brand name, rules (min QOH per size, min sizes to select an article, min live sizes to stay active, core sizes) and campaigns (each with one or more vertical + MRP-range rules). All editable; "Reset to defaults" restores the starting setup.
3. **Campaign files (one time per upload)** – Excel product list (one tab per campaign) and one Flipkart FSN upload CSV per campaign in Flipkart's template format (split at 2,000 FSNs).
4. **Live check** – checks each article's size availability on its public Flipkart product page and lists **PAUSE NOW** / **CAN RESUME** changes versus the previous check. Pages that cannot be read are marked "Check failed" and are never paused.
5. **History** – previous uploads (use any as the base) and previous live checks.

## Selection rules
- Product = `article_number` (not color). Quantities are summed across all warehouses per article + size.
- A size counts when its QOH ≥ *Min QOH per size*; an article is selected when it has ≥ *Min sizes to select* such sizes. Only those sizes' FSNs are listed.
- An FSN can belong to only one campaign; campaign order decides.
- Live check: an article stays **Active** while it has ≥ *Min live sizes* sizes in stock on Flipkart.

## Tech
- Vite + React + TypeScript frontend (Excel read/write in the browser with SheetJS).
- Netlify Functions (`netlify/functions/api.mts`) for the API and the Flipkart page check.
- Netlify Blobs for shared storage (settings, uploads, check runs). No login.

## Deploy on Netlify
Import this repository in Netlify (Add new site → Import an existing project → GitHub). Build settings come from `netlify.toml` (build `npm run build`, publish `dist`). No environment variables are needed.

## Local development
```
npm install
npm run dev        # frontend only
npx netlify dev    # frontend + functions + blobs
```
