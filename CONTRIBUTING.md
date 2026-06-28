# Contributing

This document describes how to set up, develop, validate, and deploy Hacker News Daily Codex Reader.

## Stack

- Vite
- React 19
- TypeScript
- Cloudflare Pages Functions
- Cloudflare KV
- Wrangler
- lucide-react icons

## Project Structure

```text
src/
  App.tsx           Main reader UI and settings dialog
  aiSummary.ts      Streaming AI summary API client
  hnDaily.ts        RSS fetch and parsing
  codex.ts          Codex deep-link URL generation
  sharedState.ts    Shared read-state API client
  storage.ts        localStorage persistence
functions/
  api/
    summarize-post.ts
                  Stream AI summaries and cache results
    shared-state/
      index.ts      Create shared progress ids
      [id].ts       Read and patch shared progress
  hn-daily/
    index.rss.ts    Cloudflare Pages Function RSS proxy
```

## Local Development

Install dependencies:

```bash
npm install
```

Start the Vite dev server:

```bash
npm run dev
```

Default local URL:

```text
http://127.0.0.1:5173/
```

In local Vite development, `/hn-daily/*` is proxied to `https://www.daemonology.net`.

To test Cloudflare Pages Functions and the local KV binding:

```bash
npm run dev:pages
```

`npm run dev:pages` builds the app first, then runs Cloudflare Pages locally with a local `SHARED_READ_STATE` KV binding.

To test AI summaries locally, provide an OpenRouter key as an environment variable before starting Pages dev:

```bash
OPENROUTER_API_KEY=<your-key> npm run dev:pages
```

## Commands

| Command                       | Description                                               |
|-------------------------------|-----------------------------------------------------------|
| `npm run dev`                 | Start the Vite dev server                                 |
| `npm run dev:pages`           | Build and run Cloudflare Pages locally with KV            |
| `npm run build`               | Type-check frontend and function code, then build the app |
| `npm run typecheck:functions` | Type-check Cloudflare Pages Functions only                |
| `npm run lint`                | Run ESLint                                                |
| `npm run preview`             | Preview the production build locally                      |

`npm run build` checks both the frontend TypeScript code and the Cloudflare Function types.

## Shared Progress Development

Shared progress and AI summary caching use Cloudflare KV. The binding name is:

```text
SHARED_READ_STATE
```

Shared progress API routes live in:

```text
functions/api/shared-state/
```

AI summaries use:

```text
functions/api/summarize-post.ts
```

The summary endpoint accepts only `{ postId, promptTemplate }` from the browser and returns `text/event-stream`, including cached responses. The server resolves the canonical post title and URLs from Hacker News Daily before calling OpenRouter or computing the cache key. It uses OpenRouter model `deepseek/deepseek-v4-flash`, stores successful summaries under a separate KV prefix, and rate-limits cache misses by client IP.

The shared URL is a read/write bearer link. Anyone with the URL can update the shared progress, so avoid logging or sharing these URLs unintentionally during development.

## RSS Proxy

Upstream RSS feed:

[https://www.daemonology.net/hn-daily/index.rss](https://www.daemonology.net/hn-daily/index.rss)

The app always reads from:

```text
/hn-daily/index.rss
```

In production, a Cloudflare Pages Function handles `/hn-daily/index.rss`, fetches the upstream feed, forwards `ETag` and `Last-Modified` when available, and applies:

- Browser cache: 5 minutes
- Edge cache: 15 minutes
- Upstream failure response: `502 Unable to load Hacker News Daily feed.`

## Deployment

The app is deployed on Cloudflare Pages:

- Build command: `npm run build`
- Output directory: `dist`
- Production branch: `main`

Create a KV namespace and bind it to the Pages project before deploying shared progress and AI summary caching:

1. Create a Cloudflare KV namespace.
2. In the Cloudflare Pages project, add a KV binding for both Production and Preview environments.
3. Set the binding variable name to `SHARED_READ_STATE`.
4. Add `OPENROUTER_API_KEY` as a Pages secret for Production and Preview.
5. Redeploy the Pages project.

Pushing to `main` triggers an automatic Cloudflare Pages deployment.

## Cloudflare Preview Deployment

Use a Cloudflare Pages preview deployment when you want to test a built version on Cloudflare before merging to `main`.

### Automatic Preview Deployment

Create and push a `preview/*` branch to trigger an automatic Cloudflare Pages preview deployment:

```bash
git switch -c preview/<name>
git push -u origin preview/<name>
```

### Manual Preview Deployment

Build the app locally:

```bash
npm run build
```

Deploy the built `dist` directory to the Cloudflare Pages project on a non-production branch:

```bash
npx wrangler pages deploy dist --project-name hnnews-daily --branch <branch-name>
```

Cloudflare Pages treats `main` as production and non-`main` branches as preview deployments for this project. The repository's `wrangler.toml` includes a `[env.preview]` KV binding for `SHARED_READ_STATE`, so preview deployments use the preview KV namespace instead of the production namespace.
