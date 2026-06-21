const HN_DAILY_FEED_URL = "https://www.daemonology.net/hn-daily/index.rss";
const BROWSER_CACHE_SECONDS = 300;
const EDGE_CACHE_SECONDS = 900;

export const onRequestGet: PagesFunction = async () => {
  const upstreamResponse = await fetch(HN_DAILY_FEED_URL, {
    headers: {
      Accept: "application/rss+xml,text/xml;q=0.9,*/*;q=0.8",
      "User-Agent":
        "hnnews-daily/1.0 (+https://github.com/fytriht/hnnews-daily)",
    },
    cf: {
      cacheTtl: EDGE_CACHE_SECONDS,
      cacheEverything: true,
    },
  });

  if (!upstreamResponse.ok) {
    return new Response("Unable to load Hacker News Daily feed.", {
      status: 502,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const headers = new Headers();
  headers.set("Content-Type", "application/rss+xml; charset=utf-8");
  headers.set(
    "Cache-Control",
    `public, max-age=${BROWSER_CACHE_SECONDS}, s-maxage=${EDGE_CACHE_SECONDS}`,
  );

  const etag = upstreamResponse.headers.get("etag");
  if (etag) {
    headers.set("ETag", etag);
  }

  const lastModified = upstreamResponse.headers.get("last-modified");
  if (lastModified) {
    headers.set("Last-Modified", lastModified);
  }

  return new Response(upstreamResponse.body, {
    status: 200,
    headers,
  });
};
