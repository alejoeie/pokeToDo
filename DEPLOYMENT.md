# Deploy PokéDo

Flow: GitHub → Actions checks → Render Node service → Atlas. Cloudflare DNS maps `pokedo.alebyte.me` to the service. GoDaddy remains the domain registrar. No portfolio DNS changes are required.

## 1. GitHub

Create an empty private repository named `pokedo` and push the `main` branch. Keep `.env`, `atlas-credentials.env`, and `node_modules` out of Git. The included workflow runs syntax checks and tests without Atlas credentials. Live Atlas tests are intentionally disabled in CI. No deployment token or database secret is required in GitHub Actions.

## 2. Render

Sign in with GitHub. Choose **New → Blueprint**, connect the PokéDo repository, and use the included `render.yaml`. Confirm the Free plan. Alternatively create a **Web Service**, not a Static Site:

- Branch: `main`
- Runtime: Node.js 22
- Build: `npm ci --omit=dev`
- Start: `npm start`
- Health check: `/api/health`
- Auto deploy: **After CI Checks Pass**

Configure Render environment variables privately:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `NODE_VERSION` | `22` |
| `APP_ORIGIN` | Initially `https://<actual-service>.onrender.com`; no trailing slash |
| `MONGODB_URI` | Your Atlas cluster URI |
| `MONGODB_USERNAME` | The Atlas database username |
| `MONGODB_PASSWORD` | The raw Atlas database password |
| `MONGODB_DB` | `pokedo` |

The separate Atlas username/password override credentials in the URI and are URL-encoded by the server. Do not enter Ale's or Sharlotte's login passwords as Atlas credentials. Render provides PORT automatically; do not copy the local PORT value. No secret file upload is required. Do not print secrets in logs or put them in YAML.

Atlas: add the Render service's **Connect → Outbound** IP ranges to **Network Access**. Keep the existing local IP if local administration is needed. Use an Atlas database user scoped to `pokedo`. An initial deploy may fail until network access and variables are configured; retry after configuration.

Schemas and accounts reside in Atlas, not the service filesystem. If you have not yet set up both accounts, run `npm run db:setup` locally against the same database before testing sign-in. Do not run the interactive account setup as a build/start command. No passwords are reset during deployment.

Once deployed, check the actual `onrender.com` URL, sign-in, a personal task, and a shared task. Render Free spins down after 15 minutes without inbound traffic, so the next request can take longer. Upgrade only if you want an always-on service.

## 3. Custom domain

1. Render service → **Settings → Custom Domains → Add Custom Domain**: enter `pokedo.alebyte.me`.
2. Cloudflare → **alebyte.me → DNS → Records**: add:

   | Type | Name | Target | Proxy |
   | --- | --- | --- | --- |
   | CNAME | `pokedo` | The actual `<service>.onrender.com` hostname | DNS only initially |

3. Verify the domain in Render and wait for its TLS certificate to be ready.
4. Set Render's `APP_ORIGIN=https://pokedo.alebyte.me` and redeploy. Sign-in mutations are deliberately accepted only from this exact origin. The `onrender.com` URL will still show the UI, but sign in through the custom domain after this change.
5. Visit `https://pokedo.alebyte.me`; test both accounts on separate browsers/devices. Check each private task is hidden from the other account and shared edits appear after Refresh.

Keep the existing `@`, `www`, and `blog` portfolio records intact. Do not change GoDaddy nameservers again. Leaving the new CNAME DNS-only is sufficient; optional Cloudflare proxying can be enabled after Render issues its certificate.

## References

- https://render.com/docs/blueprint-spec
- https://render.com/docs/deploys#integrating-with-ci
- https://render.com/docs/connect-to-mongodb-atlas
- https://render.com/docs/configure-cloudflare-dns
- https://render.com/docs/free
