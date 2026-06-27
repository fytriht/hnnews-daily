# Hacker News Daily Codex Reader

A small daily reading tool for Hacker News Daily. It shows the latest 10 daily issues, lists the top posts for each day, and adds a one-click Codex summary flow for every post.

Live site: [https://hnnews-daily.pages.dev](https://hnnews-daily.pages.dev)

## Features

- View the latest 10 Hacker News Daily issues
- Select an issue to see that day's top posts
- Post titles open Hacker News comments; source domains open original articles
- Each post includes a `Summarize` button that opens a new Codex thread through the `codex://threads/new` deep link
- The default Codex prompt is:

```text
总结 {originalUrl} {hnCommentsUrl}
```

- The Codex prompt template can be changed in the app settings and supports `{originalUrl}` and `{hnCommentsUrl}` placeholders
- An optional Codex project path can be configured; when blank, the new thread opens without a project path
- Selecting an issue marks it as read on the current device
- Read issues can be manually marked as unread
- A shared link can be created to sync read issues and summarized posts across devices
- Shared links use a short `?share=<id>` URL; anyone with the URL can update the shared progress
- Local read state, selected issue, summarized posts, and Codex settings are stored in browser `localStorage`
- Feed loading errors show a retry action

## Stack

- Vite
- React 19
- TypeScript
- Cloudflare Pages Functions
- Cloudflare KV
- Wrangler
- lucide-react icons

## Data Source

Upstream RSS feed:

[https://www.daemonology.net/hn-daily/index.rss](https://www.daemonology.net/hn-daily/index.rss)

The app always reads from:

```text
/hn-daily/index.rss
```

In local development, Vite proxies `/hn-daily/*` to `https://www.daemonology.net`.

In production, a Cloudflare Pages Function handles `/hn-daily/index.rss`, fetches the upstream feed, forwards `ETag` and `Last-Modified` when available, and applies:

- Browser cache: 5 minutes
- Edge cache: 15 minutes
- Upstream failure response: `502 Unable to load Hacker News Daily feed.`

## Shared Progress

The app can create a shared read-state URL. When a user clicks the share action, the app creates a 10-character base62 id and updates the current URL:

```text
/?share=<id>
```

All devices that open the same URL read and write the same Cloudflare KV-backed progress:

- Read daily issues
- Posts marked as summarized

The shared URL is a read/write bearer link. Do not share it with someone who should not be able to change the progress.

Cloudflare binding name:

```text
SHARED_READ_STATE
```

## Project Structure

```text
src/
  App.tsx           Main reader UI and settings dialog
  hnDaily.ts        RSS fetch and parsing
  codex.ts          Codex deep-link URL generation
  sharedState.ts    Shared read-state API client
  storage.ts        localStorage persistence
functions/
  api/
    shared-state/
      index.ts      Create shared progress ids
      [id].ts       Read and patch shared progress
  hn-daily/
    index.rss.ts    Cloudflare Pages Function RSS proxy
```

## Local Development

```bash
npm install
npm run dev
```

Default local URL:

```text
http://127.0.0.1:5173/
```

To test Cloudflare Pages Functions and the local KV binding:

```bash
npm run dev:pages
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

## Deployment

The app is deployed on Cloudflare Pages:

- Build command: `npm run build`
- Output directory: `dist`
- Production branch: `main`

Create a KV namespace and bind it to the Pages project before deploying shared progress:

1. Create a Cloudflare KV namespace.
2. In the Cloudflare Pages project, add a KV binding for both Production and Preview environments.
3. Set the binding variable name to `SHARED_READ_STATE`.
4. Redeploy the Pages project.

Pushing to `main` triggers an automatic Cloudflare Pages deployment.
