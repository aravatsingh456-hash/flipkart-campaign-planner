# Roadmap / parked ideas

## D2C auto-pause via supplemental feed (parked – 11 Oct 2026)

Goal: for D2C brands (own website), stop advertising low-stock products automatically instead of pausing by hand.

How it would work
1. Read the brand's catalog and per-size stock from its own website (e.g. Shopify `products/<handle>.json`) or from the client's inventory file.
2. Apply the same rules as the Flipkart planner (article = product, size counts if in stock, keep active while ≥ N sizes in stock; non-sized products use "in stock / low stock").
3. Publish a **supplemental feed** (CSV at a fixed URL on this Netlify site) with one row per catalog item ID and a label column, e.g. `custom_label_0 = active | paused_low_sizes`.
4. Connect that feed once in **Meta Commerce Manager** and **Google Merchant Center** (scheduled fetch, e.g. every few hours).
5. In Meta product sets / Google listing groups, filter to `custom_label_0 = active`. Products drop out of ads automatically when sizes run out and come back when stock returns.
6. Keep the pause register (flagged / removed-from-ads / back dates) and Excel reports.

Open questions before building
- Which client + website platform (Shopify / WooCommerce / custom)?
- Meta catalog ads, Google Shopping/PMax, or both?
- Which item ID the catalogs use (SKU vs variant ID) and how catalogs are connected today.
- Separate app vs a "D2C" mode in this app (separate app recommended).

Resume phrase: "D2C auto-pause feed project shuru karo (docs/ROADMAP.md in flipkart-campaign-planner)".
