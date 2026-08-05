# Alimentation Diététique — management system

One React app that works as a **phone app for sellers** (fast selling, debts) and a
**website dashboard** (tables, reports, charts). Backend is **Supabase** (Postgres +
Auth). Hosting is **Netlify**. All on free tiers.

Three sub-businesses (Books, Tofu, Cantine) each with detail/supply pricing, stock,
credit sales, and expenses — plus overall/shared expenses (rent, staff food, transport).

## 1. Supabase (5 min)
1. Create a free project at supabase.com.
2. Open **SQL Editor → New query**, paste all of `schema.sql`, and **Run**.
3. **Authentication → Users → Add user**: create one email + password (e.g. your dad's).
   Turn OFF "email confirmation" under Authentication → Providers → Email while testing.
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key.

## 2. Run locally (2 min)
```bash
npm install
cp .env.example .env      # then paste your URL + anon key into .env
npm run dev               # open the printed localhost URL
```
Log in with the user you created, then go to the **Stock** tab and add your products
(books, tofu items, cantine items). For tofu weight pricing, use the tiers JSON box.

## 3. Deploy to Netlify (5 min)
1. Push this folder to a GitHub repo.
2. On netlify.com → **Add new site → Import from Git** → pick the repo.
3. Build command `npm run build`, publish directory `dist` (already in `netlify.toml`).
4. **Site settings → Environment variables**: add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (same values as `.env`). Redeploy.
5. Open the site on each seller's phone → browser menu → **Add to Home Screen**.
   It now launches full-screen like an app.

## Data model (short version)
- `products` — per business; `price_detail`, `price_supply`, optional `price_tiers` (tofu), `stock`.
- `sales` + `sale_items` — one receipt; `amount_paid < total` means a debt.
- `payments` — money received later against a debt.
- `expenses` — tagged to a business, or `null` = overall/shared.
- Profit = revenue − expenses (per business, and overall including shared).
- All writes for sales go through the `create_sale` RPC so a sale + its lines + stock
  update happen atomically.

## Not built yet (phase 2 ideas)
- Printable/downloadable receipts, offline queue for weak network, per-seller accounts &
  permissions, product cost tracking for true margins, WhatsApp debt reminders.
