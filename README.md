# Hacker News Daily Codex Reader

A small daily reading tool for Hacker News Daily. It shows the latest 10 daily issues, lists the top posts for each day, adds a one-click Codex summary flow, and can summarize posts in the page with AI.

Live site: [https://hnnews-daily.pages.dev](https://hnnews-daily.pages.dev)

Development setup, validation commands, and deployment notes are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Features

- View the latest 10 Hacker News Daily issues
- Select an issue to see that day's top posts
- Post titles open Hacker News comments; source domains open original articles
- Each post includes an `AI 总结` button that streams an in-page summary from OpenRouter
- Each post includes a `Summarize` button that opens a new Codex thread through the `codex://threads/new` deep link
- The default Codex prompt is:

```text
总结 {originalUrl} {hnCommentsUrl}
```

- The prompt template can be changed in the app settings and supports `{title}`, `{originalUrl}`, and `{hnCommentsUrl}` placeholders
- An optional Codex project path can be configured; when blank, the new thread opens without a project path
- Selecting an issue marks it as read on the current device
- Read issues can be manually marked as unread
- A shared link can be created to sync read issues and summarized posts across devices
- Shared links use a short `?share=<id>` URL; anyone with the URL can update the shared progress
- Local read state, selected issue, summarized posts, and Codex settings are stored in browser `localStorage`
- Feed loading errors show a retry action

## AI Summary API

The in-page AI summary flow posts to:

```text
/api/summarize-post
```

The endpoint streams Server-Sent Events:

- `meta` with `cached`, `model`, and `generatedAt`
- `delta` with text chunks
- `done` when complete
- `error` with a user-facing message

The production model is:

```text
deepseek/deepseek-v4-flash
```

The OpenRouter API key must be configured as a Cloudflare Pages secret named:

```text
OPENROUTER_API_KEY
```

Do not commit real API keys. The server caches successful summaries in KV for 90 days and applies a small per-IP hourly rate limit on cache misses.

## Data Source

Upstream RSS feed:

[https://www.daemonology.net/hn-daily/index.rss](https://www.daemonology.net/hn-daily/index.rss)

The app always reads from:

```text
/hn-daily/index.rss
```

## Shared Progress

The app can create a shared read-state URL. When a user clicks the share action, the app creates a 10-character base62 id and updates the current URL:

```text
/?share=<id>
```

All devices that open the same URL read and write the same Cloudflare KV-backed progress:

- Read daily issues
- Posts marked as summarized

The shared URL is a read/write bearer link. Do not share it with someone who should not be able to change the progress.

The same KV namespace also stores cached AI summaries and cache-miss rate-limit counters under separate key prefixes.
