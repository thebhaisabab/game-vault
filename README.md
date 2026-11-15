# GAME VAULT

Your personal game library — searchable against **every game in the world**, synced across every device, and styled like a trophy room.

- Search the global game catalogue (PlayStation, Xbox, Nintendo, PC, retro) and add titles in one click — **cover art is pulled from the internet automatically**
- Track what you're **Playing / Completed / Backlog / Wishlist / Paused / Dropped**, plus the platform you played on (**PS5, PS4, PS3, Xbox Series X|S, Xbox One, Switch, PC…**), your own 1–10 rating, hours played, notes, and favorites
- **`/psn-deals` — PS5 Deals & Console Price Tracker**: live discounted games mirrored from the PlayStation Store Turkey deals hub (₺; campaigns/collections like All Deals and seasonal promos become selectable pills; `store.playstation.com` en-tr pages with full browser headers, automatic fallback to psdeals.net / psprices.com when Akamai blocks datacenter IPs; honest "unavailable" state — no fake games — when everything fails), a PostgreSQL-synced custom watchlist with **live catalog price lookups** (full price / on-sale per entry), a force-refresh-bypassing-cache button (30-minute `revalidate` otherwise), a live ₺TRY ↔ ৳BDT converter (open.er-api.com), and a **worldwide PS5 console price board** (USA/UK/Germany/Japan/Turkey) fed by regional `playstation.com/{locale}/ps5/buy-now/` pages (JSON-LD → embedded JSON → currency regex, sanity-bounded), with PS Direct fallbacks, per-row LIVE/CURATED badges, exact fetch timestamps, and every price auto-converted to ৳ BDT at the live FX rate and a "best deal in Taka" callout (PS Direct regions refresh live when reachable; Japan/Turkey are a labelled curated snapshot)
- Switch between **Tile**, **List**, and **Showcase** views (keys `1` `2` `3`)
- **Synced across devices** — everything lives in PostgreSQL, so open it on your phone, laptop and TV and it's always the same vault
- Filter by status, platform, free text; sort by add date, title, release year, your rating or critics' score

## Stack

Next.js (App Router) · React 19 · Tailwind CSS v4 · framer-motion · Drizzle ORM · PostgreSQL

## Run locally

```bash
npm install
cp .env.example .env        # fill in values below
npx drizzle-kit push        # create the library tables (psn_watchlist self-creates)
npm run dev
```

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. Powers cross-device sync; `psn_watchlist` self-creates on first request (idempotent `CREATE TABLE IF NOT EXISTS`) and the UI falls back to browser-local storage when it's missing. |

> Search works out of the box with **zero API keys** — the catalogue comes from the public Steam Store search API and the public Wikipedia/Wikidata APIs, covering PC, PlayStation, Xbox, Nintendo and retro titles with cover/header artwork, release years, descriptions, developer and publisher. Nothing else to configure. Every game can also be added **manually** from the search panel.

## Host it on GitHub

```bash
git init
git add .
git commit -m "game vault"
git branch -M main
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

`.env` is git-ignored — your keys stay local. Commit `.env.example` instead.

## Deploy (synced across all your devices)

Because the library syncs through a database, deploy to a host that runs the Next.js server — [Vercel](https://vercel.com) is the happy path:

1. Create a free Postgres database on [Neon](https://neon.tech), [Supabase](https://supabase.com), or Vercel Postgres. Copy its connection string.
2. Import your GitHub repo at [vercel.com/new](https://vercel.com/new).
3. Add env vars in project settings: `DATABASE_URL`. Search needs no keys — it uses the public Steam Store and Wikipedia/Wikidata APIs out of the box.
4. Deploy. Done — the watchlist table creates itself on first use; the library tables:
   ```bash
   DATABASE_URL="<your-production-db-url>" npx drizzle-kit push
   ```
   Without `DATABASE_URL` the app still deploys fine — the PSN watchlist is stored in the browser instead of synced.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `A` | Add a game |
| `/` | Filter library |
| `1` `2` `3` | Tile / List / Showcase view |
| `Esc` | Close panels |
