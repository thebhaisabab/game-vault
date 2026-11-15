# GAME VAULT

Your personal game library — searchable against **every game in the world**, synced across every device, and styled like a trophy room.

- Search the global game catalogue (PlayStation, Xbox, Nintendo, PC, retro) and add titles in one click — **cover art is pulled from the internet automatically**
- Track what you're **Playing / Completed / Backlog / Wishlist / Paused / Dropped**, plus the platform you played on (**PS5, PS4, PS3, Xbox Series X|S, Xbox One, Switch, PC…**), your own 1–10 rating, hours played, notes, and favorites
- **`/psn-deals` — PS5 Deals & Console Price Tracker**: discounted games on the PlayStation Store Turkey (₺, best-effort live fetch with a labelled offline snapshot fallback), a PostgreSQL-synced custom watchlist that flags your tracked games when they go on sale, a live ₺TRY ↔ ৳BDT converter (open.er-api.com), and a curated worldwide PS5 console price board for USA, UK, Europe, Japan and Turkey
- Switch between **Tile**, **List**, and **Showcase** views (keys `1` `2` `3`)
- **Synced across devices** — everything lives in PostgreSQL, so open it on your phone, laptop and TV and it's always the same vault
- Filter by status, platform, free text; sort by add date, title, release year, your rating or critics' score

## Stack

Next.js (App Router) · React 19 · Tailwind CSS v4 · framer-motion · Drizzle ORM · PostgreSQL

## Run locally

```bash
npm install
cp .env.example .env        # fill in values below
npx drizzle-kit push        # create the tables (library + psn_watchlist)
npm run dev
```

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (required). Powers cross-device sync. |

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
4. Deploy, then create the tables once:
   ```bash
   DATABASE_URL="<your-production-db-url>" npx drizzle-kit push
   ```
5. Done — open the URL on any device and your library follows you.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `A` | Add a game |
| `/` | Filter library |
| `1` `2` `3` | Tile / List / Showcase view |
| `Esc` | Close panels |
