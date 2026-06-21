import type { DailyIssue, HnPost } from "./types";

const FEED_URL = "/hn-daily/index.rss";
const MAX_ISSUES = 10;

export async function fetchDailyIssues(): Promise<DailyIssue[]> {
  const response = await fetch(FEED_URL, {
    headers: {
      Accept: "application/rss+xml,text/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch HN Daily feed: ${response.status}`);
  }

  return parseDailyIssues(await response.text());
}

export function parseDailyIssues(xml: string): DailyIssue[] {
  const rss = new DOMParser().parseFromString(xml, "application/xml");
  const parseError = rss.querySelector("parsererror");

  if (parseError) {
    throw new Error("HN Daily feed returned invalid XML.");
  }

  return Array.from(rss.querySelectorAll("channel > item"))
    .slice(0, MAX_ISSUES)
    .map((item) => {
      const title = requiredText(item, "title");
      const permalink = requiredText(item, "link");
      const pubDate = requiredText(item, "pubDate");
      const description = requiredText(item, "description");
      const date = extractDate(title, permalink);

      return {
        date,
        title,
        permalink,
        pubDate,
        posts: parsePosts(description, date),
      };
    });
}

function parsePosts(descriptionHtml: string, issueDate: string): HnPost[] {
  const html = new DOMParser().parseFromString(descriptionHtml, "text/html");

  return Array.from(html.querySelectorAll("li"))
    .map((item, index) => {
      const storyLink = item.querySelector<HTMLAnchorElement>(".storylink a");
      const commentsLink = item.querySelector<HTMLAnchorElement>(".postlink a");

      if (!storyLink?.href || !commentsLink?.href) {
        return null;
      }

      return {
        id: `${issueDate}-${index + 1}`,
        title: cleanText(storyLink.textContent),
        originalUrl: storyLink.href,
        hnCommentsUrl: commentsLink.href,
      };
    })
    .filter((post): post is HnPost => Boolean(post));
}

function requiredText(parent: Element, selector: string): string {
  const text = parent.querySelector(selector)?.textContent?.trim();

  if (!text) {
    throw new Error(`HN Daily feed is missing ${selector}.`);
  }

  return text;
}

function extractDate(title: string, permalink: string): string {
  const titleMatch = title.match(/\d{4}-\d{2}-\d{2}/);
  if (titleMatch) {
    return titleMatch[0];
  }

  const linkMatch = permalink.match(/\d{4}-\d{2}-\d{2}/);
  if (linkMatch) {
    return linkMatch[0];
  }

  throw new Error(`Could not infer issue date for ${title}.`);
}

function cleanText(value: string | null): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}
