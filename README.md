# Hacker News Daily Codex Reader

A small daily reading tool for Hacker News Daily. It shows the latest 10 daily issues, lists the top posts for each day, and adds a one-click Codex summary flow for every post.

Live site: [https://hnnews-daily.pages.dev](https://hnnews-daily.pages.dev)

Development setup, validation commands, and deployment notes are in [CONTRIBUTING.md](CONTRIBUTING.md).

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
