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

## D2C mode (brand website → Meta / Google product lists)

Use the **Flipkart | D2C** switch at the top of the sidebar. D2C has its own uploads, settings, website checks and pause register (stored under `d2c/` in the same Blobs store), so nothing mixes with Flipkart.

1. **Upload stock file** – the website discount / stock Excel (columns: sku, Product Name, Option, Category, Gender, MRP, SOH, discount %). Only footwear categories in Settings with SOH > 0 are saved.
2. **Settings** – minimum SOH per size (20), Men core sizes (7, 8, 9, 10 – all needed), Women minimum sizes (any 4), Unisex in both, categories with the High AOV cut-off on sale price (PRUN ₹6,000 · SPS ₹5,000 · CPS ₹6,000).
3. **Website check** – looks up every qualifying article on asics.co.in (in-stock sizes, price, shoe type, URL). Runs from the browser; the Netlify function (`/api/d2c/check`) is a fallback.
4. **Files** – four Excel files: Discounted / Non-discounted detailed sheets and Discounted / Non-discounted ID files (per campaign tab: Meta table with Option, Google table with sku, both with product URL).
5. **Pause register** – an article listed in the previous check that drops out goes to "To pause" (Option + skus to remove); when it qualifies again it shows under "Can resume".

## Campaign reports (Flipkart)

**Campaign reports** page: upload one or more Flipkart Ads "All FSNs of campaign" CSV exports. Each report is linked to a planner campaign (picked from the list, or created from the report — rules are suggested per vertical with the MRP range of its FSNs; created campaigns are "tracking only" until switched on in Settings). The report is compared with the current QOH upload and the latest live check (or its own "Check these articles on Flipkart" run) and split into: new articles to add (restocked), sizes to add, to resume, to pause, keep running – check, size out of stock, not in upload, running OK, keep paused. Downloads: full action report, new-articles report and a Flipkart upload CSV of the FSNs to add. Uploading a report also updates the pause register (all FSNs paused in Flipkart → "Paused"; running again → "Resumed").
