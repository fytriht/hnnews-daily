# HN Daily Codex Reader

A small daily reading tool for Hacker News Daily. It shows the latest 7 daily issues, lists the top posts for each day, and adds a one-click Codex summary flow for every post.

Live site: [https://hnnews-daily.pages.dev](https://hnnews-daily.pages.dev)

## Features

- View the latest 7 Hacker News Daily issues
- Open an issue to see that day's top posts
- Each post includes the original article link, HN comments link, and a `Codex summarize` button
- `Codex summarize` opens a new Codex thread with this prompt:

```text
总结 {originalUrl} {hnCommentsUrl}
```

- The Codex prompt template can be changed in the app settings. It supports `{originalUrl}` and `{hnCommentsUrl}` placeholders.
- The Codex project path is optional. If it is blank, Codex opens the new thread without a project path.
- Opening an issue marks it as read on the current device
- Read issues can be manually marked as unread
- Read state is stored in browser `localStorage`

## Stack

- Vite
- React
- TypeScript
- Cloudflare Pages Functions

## Data Source

RSS feed:

[https://www.daemonology.net/hn-daily/index.rss](https://www.daemonology.net/hn-daily/index.rss)

Local development uses the Vite proxy for:

```text
/hn-daily/index.rss
```

Production uses a Cloudflare Pages Function at the same path.

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

```bash
npm run dev
npm run build
npm run lint
npm run preview
```

`npm run build` checks both the frontend TypeScript code and the Cloudflare Function types.

## Deployment

The app is deployed on Cloudflare Pages.

- Build command: `npm run build`
- Output directory: `dist`
- Production branch: `main`

Pushing to `main` triggers an automatic Cloudflare Pages deployment.
