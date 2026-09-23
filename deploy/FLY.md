# Deploy Rent-a-mec on Fly.io

## One-time setup

```bash
# Install CLI: https://fly.io/docs/hands-on/install-flyctl/
fly auth login

cd rentamec-demo-prod

# Create app (name must be unique globally — change in fly.toml if taken)
fly apps create rentamec-demo

# Create volume in same region as primary_region
fly volumes create rentamec_data --region iad --size 1

# Secrets (generate a strong JWT secret)
fly secrets set JWT_SECRET="$(openssl rand -hex 32)" HTTPS=0

# Optional Stripe (test or live)
# fly secrets set STRIPE_SECRET_KEY=sk_test_... STRIPE_PUBLISHABLE_KEY=pk_test_...

fly deploy

# After deploy, set public URL for Stripe redirects
fly secrets set APP_URL=https://rentamec-demo.fly.dev
```

Open: **https://rentamec-demo.fly.dev**

Demo logins (after seed on first boot):  
`buyer@demo.com` / `demo1234` · `marcus@demo.com` / `demo1234`

## Useful commands

```bash
fly status
fly logs
fly ssh console
fly scale count 1
```
