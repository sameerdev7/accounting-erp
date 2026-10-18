# Deploying to Netlify

The application is a **fully client-side** single-page app. `npm run build` produces a static
`dist/` folder that can be served by any web host; there is no server, no database and no runtime
configuration. Netlify is a good fit because it serves static files over HTTPS and builds on push.

The repository already contains a [`netlify.toml`](../netlify.toml) with the right build command,
publish directory, Node version, SPA fallback and cache headers, so Netlify needs almost no manual
configuration.

---

## 0. Prerequisites

- Node.js 20 or newer and npm.
- A [Netlify](https://app.netlify.com) account (free tier is fine).
- The project folder (`accounting-erp/`).

Verify the build locally first:

```bash
cd accounting-erp
npm install
npm run build     # type-checks, then writes dist/
npm run preview   # serves dist/ at http://localhost:4173 — click through it
```

If `npm run preview` works, the deployed site will work.

---

## Option A — Drag-and-drop (no Git, fastest)

Good for a one-off submission upload.

1. Run `npm run build`. This creates `accounting-erp/dist/`.
2. Open <https://app.netlify.com/drop>.
3. Drag the **`dist`** folder (not the project folder) onto the drop zone.
4. Netlify uploads it and gives you a URL such as `https://random-name-123.netlify.app`.
5. Rename the site under **Site configuration → Site details → Change site name**.

> Drag-and-drop ignores `netlify.toml`. Because the app uses **hash routing** (`/#/reports/...`),
> every route still works without it. If you later switch to browser history routing, use Option B
> or add a `_redirects` file with `/*  /index.html  200`.

---

## Option B — Git-connected (recommended: rebuilds on every push)

1. Push the project to a Git host (GitHub, GitLab or Bitbucket).
2. In Netlify, choose **Add new site → Import an existing project** and pick the repository.
3. Set:
   - **Base directory:** `accounting-erp` (only if the repo root is one level above it)
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
4. Netlify reads `netlify.toml`, so the build command, publish directory, Node 20 and the SPA
   redirect are filled in automatically. Confirm them and click **Deploy**.

Every push to the production branch triggers a fresh build and deploy; pull requests get deploy
previews automatically.

**Via the Netlify CLI** (alternative to the dashboard):

```bash
npm install -g netlify-cli
cd accounting-erp
npm run build
netlify deploy --dir=dist --prod      # first run links/creates the site
```

---

## 1. What `netlify.toml` does

| Setting | Value | Why |
|---|---|---|
| `build.command` | `npm run build` | Runs `tsc --noEmit && vite build`. |
| `build.publish` | `dist` | Vite's output directory. |
| `build.environment.NODE_VERSION` | `20` | Matches the project's requirement. |
| `redirects` | `/* → /index.html` (200) | Serves the SPA shell for any path (safe with hash routing; required if you ever move to history routing). |
| `headers` (`/assets/*`) | `max-age=31536000, immutable` | Fingerprinted assets can be cached forever. |
| `headers` (`/index.html`) | `must-revalidate` | Always pick up a new deployment. |

---

## 2. Custom domain (optional)

1. **Domain management → Add a domain** and enter your domain.
2. Point the DNS at Netlify (Netlify DNS, or a `CNAME` to `<site>.netlify.app` for a subdomain).
3. Netlify provisions a free Let's Encrypt TLS certificate automatically. Force HTTPS under
   **Domain management → HTTPS**.

---

## 3. Post-deploy checklist

- [ ] Open the site; the sign-in page loads and the quick sign-in buttons work.
- [ ] Sign in as `admin` (shared password `erp1234`) and confirm the dashboard's eight tiles
      populate.
- [ ] Open **Backup & Reset** and export a JSON backup to confirm downloads work over HTTPS.
- [ ] Open a report and confirm CSV/XLSX export and print work.
- [ ] Confirm a deep link such as `https://<site>.netlify.app/#/reports/trial-balance` loads on a
      hard refresh.

---

## 4. Important notes about the data

- **All data lives in the visitor's browser IndexedDB**, keyed to the deployed origin. Seeding runs
  automatically on first load.
- Deploying a new version does **not** wipe a visitor's data, but clearing browser storage, using a
  different browser/device, or changing the **site domain** starts a fresh, separately seeded
  database. There is no server-side shared data.
- Use **Administration → Backup & Reset** to export/import the whole database as a JSON file; this
  is the only durable safety net.
- Because there is no backend, two visitors never see each other's data. This is expected for this
  design and is stated in the README's assumptions.

---

## 5. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Build fails with a TypeScript error | The build runs `tsc --noEmit` first; run `npm run build` locally and fix the error. |
| Blank page after deploy | Publish directory is wrong — it must be `dist`, and the base directory must be `accounting-erp` if the repo root is the parent folder. |
| 404 on refresh of a sub-path | The `[[redirects]]` block is missing. Drag-and-drop ignores `netlify.toml`; upload via Git or add `public/_redirects` containing `/*  /index.html  200`. |
| Old version still showing | Assets are cached immutably but `index.html` revalidates; do a hard refresh. |
| Build uses the wrong Node | `netlify.toml` pins `NODE_VERSION = "20"`; also settable in **Site configuration → Environment variables**. |
