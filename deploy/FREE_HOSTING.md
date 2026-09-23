# Free stable hosting for investor demos

## Recommended: Render (free)

1. Push this project to a **public GitHub repo** (or private + grant Render access).
2. Go to [https://dashboard.render.com](https://dashboard.render.com) → sign up free.
3. **New** → **Blueprint** → connect the repo (uses `render.yaml`),  
   **or** **New** → **Web Service** → connect repo → Runtime **Docker** → Plan **Free**.
4. Deploy. Wait 2–5 minutes.
5. Open `https://<service-name>.onrender.com`
6. In Render → Environment, set:
   ```
   APP_URL=https://<service-name>.onrender.com
   ```
   (optional Stripe test keys if you want real checkout)

**Note:** Free tier spins down after ~15 min idle. First request after sleep can take 30–60s — tell investors to wait once if the page is slow.

Demo logins: `buyer@demo.com` / `demo1234` · `marcus@demo.com` / `demo1234`

## Alternatives

| Platform | Free tier | Notes |
|----------|-----------|--------|
| **Render** | Yes | Best fit; Docker; sleeps when idle |
| **Koyeb** | Yes | Docker; good cold starts |
| **Fly.io** | Allowance | Needs card on file sometimes; see FLY.md |
| **Railway** | Trial credits | Not permanently free |

## GitHub one-liner for investors (after Render deploy)

Share: **https://your-app.onrender.com**  
Logins above.
