# PolyScores — Polymarket Sports Odds

Live Polymarket sports odds, Flashscore-style.

## Deploy on Vercel (2 minutes)

```bash
# 1. Clone / download this folder
cd polyscores

# 2. Init git & push to GitHub
git init
git add .
git commit -m "init polyscores"
gh repo create polyscores --public --push --source=.
# ou: créer le repo sur github.com, puis git remote add + push

# 3. Deploy
# Option A: via Vercel CLI
npm i -g vercel
vercel

# Option B: via vercel.com
# → Import repo GitHub → Framework = Vite → Deploy
```

That's it. The `/api/proxy.js` serverless function handles CORS automatically.

## Local dev

```bash
npm install
npm run dev
```

Note: In local dev, the app tries to call the Polymarket API directly. If CORS blocks it, deploy to Vercel where the proxy handles it.

## Referral link

Edit `src/App.jsx`, find `REFERRAL_TAG` and set your Polymarket referral parameter:

```js
const REFERRAL_TAG = "?ref=YOUR_REFERRAL_CODE";
```

## Stack

- Vite + React
- Polymarket Gamma API (free, public)
- Vercel (free tier)
- Zero database, zero backend
