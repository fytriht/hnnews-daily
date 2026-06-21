export interface HnPost {
  id: string;
  title: string;
  originalUrl: string;
  hnCommentsUrl: string;
}

export interface DailyIssue {
  date: string;
  title: string;
  permalink: string;
  pubDate: string;
  posts: HnPost[];
}

export type ReadState = Record<string, boolean>;

export type VisitedLinkState = Record<string, boolean>;
