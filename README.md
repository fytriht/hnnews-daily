# HN Daily Codex Reader

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
- Read state, selected issue, and Codex settings are stored in browser `localStorage`
- Feed loading errors show a retry action

## Stack

- Vite
- React 19
- TypeScript
- Cloudflare Pages Functions
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

## Project Structure

```text
src/
  App.tsx           Main reader UI and settings dialog
  hnDaily.ts        RSS fetch and parsing
  codex.ts          Codex deep-link URL generation
  storage.ts        localStorage persistence
functions/
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

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check frontend and function code, then build the app |
| `npm run typecheck:functions` | Type-check Cloudflare Pages Functions only |
| `npm run lint` | Run ESLint |
| `npm run preview` | Preview the production build locally |

`npm run build` checks both the frontend TypeScript code and the Cloudflare Function types.

## Deployment

The app is deployed on Cloudflare Pages:

- Build command: `npm run build`
- Output directory: `dist`
- Production branch: `main`

Pushing to `main` triggers an automatic Cloudflare Pages deployment.
