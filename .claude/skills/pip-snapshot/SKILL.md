---
name: pip-snapshot
description: Build and deploy a static, read-only snapshot of PIP that runs without the server — for sharing the current state of Key's workspace with someone else. Use when the user asks to deploy a demo, share a snapshot, publish PIP, send someone a link to their work, or redeploy the static site.
---

# PIP static snapshot

Builds a serverless, read-only copy of PIP and deploys it. The point is to
hand someone a link so they can explore the real current state without
standing up any infrastructure.

## Run it

```
npm run snapshot          # build only -> ./snapshot
npm run snapshot:deploy   # build, then deploy to Netlify (prod)
```

The server must be running first — the snapshot captures the real API's
responses, which is what makes it survive schema and UI changes. If it isn't
up, the script says so and exits.

```
npm run server
```

## What it produces

- the real built frontend (same bundle as live — UI changes come along free)
- every collection, detail route, and attachment response as `.json`
- attachment image bytes at the same URLs the app already requests
- `/api/search/index` — the shaped search index, filtered in the browser
- `index.html` with `window.__PIP_STATIC__` injected
- `_redirects` so Netlify serves the SPA but never rewrites `/api/*`

## Rules

**Confirm before deploying.** A snapshot contains real client work — project
names, ticket titles, ADO descriptions, journal entries. Deploying publishes
that to a public URL that anyone with the link can read. Say what's in it and
get an explicit yes before running a deploy. Building locally needs no
confirmation.

**Never hand-edit `snapshot/`.** It's generated and gitignored. If something
is wrong, fix the source and re-run.

**Adding a new API collection?** Add one line to `ENDPOINTS` in
`scripts/pip-snapshot.js`. Detail routes and attachments are discovered by
walking the collections, so nothing else needs touching. Everything else about
the data model can change freely.

**Verify before reporting success.** Serve `snapshot/` locally and confirm the
read-only banner appears, a widget loads, and search returns results:

```
cd snapshot && python3 -m http.server 4599
```

Search is the piece most likely to break, because it's the one thing that
can't be captured as a fixed response — it filters the captured index in the
browser.

## Deploying

Netlify CLI is not installed globally; `npx --yes netlify-cli` handles it. The
first deploy needs auth (`npx netlify-cli login`) and will prompt to create or
link a site. Subsequent deploys reuse `.netlify/state.json`.

Always report the deploy URL back to the user — that's the deliverable.

## After deploying

Tell the user:
- the live URL
- when the snapshot was taken (it's in `snapshot.json` and on the banner)
- that it's a point-in-time copy — re-run to refresh it
