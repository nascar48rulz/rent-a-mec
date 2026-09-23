# Rent-a-mec — Production stack

Rent a certified mechanic for pre-purchase car inspections and buying support.

**Stack:** Node.js · SQLite · Stripe Checkout · TLS via Caddy / nginx / Cloudflare

---

## Local (dev)

```bash
cd rent-a-mec-prod
npm run seed
npm start                 # https://localhost:3847  (Node self-signed TLS)
```

Or Node (HTTP) + Caddy (TLS):

```bash
HTTPS=0 ./deploy/start-with-caddy.sh
# → https://localhost  (Caddy internal CA)
```

Demo accounts (password `demo1234`): `buyer@demo.com` · `marcus@demo.com` · `priya@demo.com`

---

## Production deploy checklist

### 1. Domain + DNS

Point your domain at the server:

| Record | Name | Value |
|--------|------|--------|
| A | `@` | your server IP |
| A | `www` | your server IP |

(Or use a Cloudflare Tunnel and skip opening ports — see below.)

### 2. Environment

```bash
cp .env.production.example .env
# Edit .env:
```

```env
PORT=3847
HTTPS=0                          # TLS is terminated by Caddy/nginx/Cloudflare
NODE_ENV=production
APP_URL=https://YOUR_DOMAIN      # must match the public URL (Stripe redirects)

JWT_SECRET=<long random string>

# Live keys only after test-mode QA
# https://dashboard.stripe.com/apikeys
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
```

**Never commit real live keys.** Rotate immediately if leaked.

### 3. TLS — pick one

#### Option A — Caddy (recommended)

Caddy gets and renews **Let's Encrypt** certs automatically.

1. Edit `deploy/Caddyfile` — replace every `YOUR_DOMAIN` with your domain.
2. On the server (ports 80 + 443 open):

```bash
# App on HTTP loopback
HTTPS=0 PORT=3847 node server/index.js &

# TLS termination
./deploy/caddy run --config deploy/Caddyfile
# or: caddy start --config deploy/Caddyfile
```

#### Option B — nginx + Certbot

1. Edit `deploy/nginx.conf` — replace `YOUR_DOMAIN`.
2. Install nginx + certbot, copy config, obtain certs:

```bash
sudo certbot --nginx -d YOUR_DOMAIN -d www.YOUR_DOMAIN
sudo nginx -t && sudo systemctl reload nginx
```

Node still listens on `127.0.0.1:3847` with `HTTPS=0`.

#### Option C — Cloudflare Tunnel (no open ports)

1. Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/).
2. `cloudflared tunnel login` → `cloudflared tunnel create rentamec`
3. Edit `deploy/cloudflared.yml` with tunnel ID + domain.
4. DNS CNAME: `YOUR_DOMAIN` → `<tunnel-id>.cfargotunnel.com`
5. Run:

```bash
HTTPS=0 node server/index.js &
cloudflared tunnel --config deploy/cloudflared.yml run
```

Cloudflare can also provide orange-cloud proxy TLS if you use regular DNS + origin cert instead of a tunnel.

### 4. Stripe (live)

1. Complete test-mode checkout end-to-end with `sk_test_` / `pk_test_`.
2. Switch `.env` to **live** keys (`sk_live_` / `pk_live_`).
3. In [Stripe Dashboard → Settings → Checkout / Branding](https://dashboard.stripe.com/settings/checkout), set business name and success branding.
4. Ensure `APP_URL` is exactly `https://YOUR_DOMAIN` so success/cancel URLs work.
5. (Optional) Add a webhook endpoint later for `checkout.session.completed` if you move off redirect-based confirm.

### 5. Process management

Use systemd, PM2, or Docker so the app restarts on reboot. Minimal systemd unit example:

```ini
[Unit]
Description=Rent-a-mec
After=network.target

[Service]
WorkingDirectory=/opt/rent-a-mec
EnvironmentFile=/opt/rent-a-mec/.env
ExecStart=/usr/bin/node server/index.js
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

Run Caddy/nginx as their own services.

### 6. Verify

```bash
curl -s https://YOUR_DOMAIN/api/health
# → "https": false (Node), TLS ok at edge
# → "stripe": { "configured": true, "demoMode": false }
```

---

## Pricing

| Duration | Rate | Total |
|----------|------|-------|
| 1–3 hrs | $95/hr | $95 / $190 / $285 |
| **4 hrs** | **$89/hr** | **$356** |

Max 4 hours.

## API (summary)

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/health` | db / https / stripe status |
| POST | `/api/bookings` | create (buyer) |
| POST | `/api/bookings/:id/pay` | Stripe Checkout session |
| GET | `/api/payments/confirm?session_id=` | after redirect |
| POST | `/api/bookings/:id/accept` | mechanic |
| POST | `/api/bookings/:id/complete` | mechanic |

## Layout

```
rent-a-mec-prod/
├── server/           # Node app (SQLite, Stripe, auth)
├── public/           # SPA
├── deploy/
│   ├── Caddyfile           # production TLS (Let's Encrypt)
│   ├── Caddyfile.local     # local TLS
│   ├── nginx.conf
│   ├── cloudflared.yml
│   ├── caddy               # binary (linux amd64)
│   └── start-with-caddy.sh
├── .env.production.example
└── scripts/seed.js
```

---

© 2026 Rent-a-mec

---

## Deploy on Fly.io

Config is ready: `Dockerfile`, `fly.toml`, volume mount at `/data` for SQLite.

```bash
# On your machine (interactive login required)
curl -L https://fly.io/install.sh | sh
fly auth login

cd rent-a-mec-prod
fly apps create rentamec-demo    # skip if name taken — edit fly.toml app =
fly volumes create rentamec_data --region iad --size 1
fly secrets set JWT_SECRET="$(openssl rand -hex 32)" HTTPS=0
fly deploy
fly secrets set APP_URL=https://rentamec-demo.fly.dev
```

App URL: **https://rentamec-demo.fly.dev**

See `deploy/FLY.md` for full notes.
