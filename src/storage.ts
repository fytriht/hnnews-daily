import {
  DEFAULT_CODEX_PROMPT_TEMPLATE,
  type CodexSettings,
} from "./codex";
import type { DailyIssue, HnPost, ReadState, SummarizedPostState } from "./types";

const READ_STATE_KEY = "hn-daily-reader:read-days";
const SELECTED_DATE_KEY = "hn-daily-reader:selected-date";
const CODEX_SETTINGS_KEY = "hn-daily-reader:codex-settings";
const SUMMARIZED_POSTS_KEY = "hn-daily-reader:summarized-posts";
const DAILY_ISSUES_CACHE_KEY = "hn-daily-reader:daily-issues-cache:v1";
const SHARED_STATE_CACHE_KEY_PREFIX =
  "hn-daily-reader:shared-state-cache:v1:";
const ISSUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const POST_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-\d+$/;
const SHARE_ID_PATTERN = /^[A-Za-z0-9]{10}$/;

export interface StoredSharedStateSnapshot {
  readState: ReadState;
  summarizedPosts: SummarizedPostState;
}

export function readStoredReadState(): ReadState {
  try {
    const raw = window.localStorage.getItem(READ_STATE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === "boolean"),
    ) as ReadState;
  } catch {
    return {};
  }
}

export function writeStoredReadState(readState: ReadState) {
  window.localStorage.setItem(READ_STATE_KEY, JSON.stringify(readState));
}

export function readStoredSummarizedPosts(): SummarizedPostState {
  try {
    const raw = window.localStorage.getItem(SUMMARIZED_POSTS_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => value === true),
    ) as SummarizedPostState;
  } catch {
    return {};
  }
}

export function writeStoredSummarizedPosts(
  summarizedPosts: SummarizedPostState,
) {
  window.localStorage.setItem(
    SUMMARIZED_POSTS_KEY,
    JSON.stringify(summarizedPosts),
  );
}

export function readStoredDailyIssues(): DailyIssue[] {
  try {
    const raw = window.localStorage.getItem(DAILY_ISSUES_CACHE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(readDailyIssue)
      .filter((issue): issue is DailyIssue => Boolean(issue));
  } catch {
    return [];
  }
}

export function writeStoredDailyIssues(issues: DailyIssue[]) {
  if (issues.length === 0) {
    return;
  }

  window.localStorage.setItem(DAILY_ISSUES_CACHE_KEY, JSON.stringify(issues));
}

export function readStoredSharedStateSnapshot(
  shareId: string,
): StoredSharedStateSnapshot | null {
  if (!SHARE_ID_PATTERN.test(shareId)) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getSharedStateCacheKey(shareId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return {
      readState: readTrueMap(parsed.readState),
      summarizedPosts: readTrueMap(parsed.summarizedPosts),
    };
  } catch {
    return null;
  }
}

export function writeStoredSharedStateSnapshot(
  shareId: string,
  snapshot: StoredSharedStateSnapshot,
) {
  if (!SHARE_ID_PATTERN.test(shareId)) {
    return;
  }

  window.localStorage.setItem(
    getSharedStateCacheKey(shareId),
    JSON.stringify({
      readState: readTrueMap(snapshot.readState),
      summarizedPosts: readTrueMap(snapshot.summarizedPosts),
    }),
  );
}

export function readStoredSelectedDate(): string | null {
  try {
    const selectedDate = window.localStorage.getItem(SELECTED_DATE_KEY);

    return selectedDate && ISSUE_DATE_PATTERN.test(selectedDate)
      ? selectedDate
      : null;
  } catch {
    return null;
  }
}

export function writeStoredSelectedDate(selectedDate: string | null) {
  if (selectedDate) {
    window.localStorage.setItem(SELECTED_DATE_KEY, selectedDate);
    return;
  }

  window.localStorage.removeItem(SELECTED_DATE_KEY);
}

export function readStoredCodexSettings(): CodexSettings {
  try {
    const raw = window.localStorage.getItem(CODEX_SETTINGS_KEY);
    if (!raw) {
      return getDefaultCodexSettings();
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return getDefaultCodexSettings();
    }

    const promptTemplate =
      typeof parsed.promptTemplate === "string" && parsed.promptTemplate.trim()
        ? parsed.promptTemplate
        : DEFAULT_CODEX_PROMPT_TEMPLATE;
    const projectPath =
      typeof parsed.projectPath === "string" ? parsed.projectPath.trim() : "";

    return {
      promptTemplate,
      projectPath,
    };
  } catch {
    return getDefaultCodexSettings();
  }
}

export function writeStoredCodexSettings(settings: CodexSettings) {
  window.localStorage.setItem(
    CODEX_SETTINGS_KEY,
    JSON.stringify({
      promptTemplate: settings.promptTemplate.trim()
        ? settings.promptTemplate
        : DEFAULT_CODEX_PROMPT_TEMPLATE,
      projectPath: settings.projectPath.trim(),
    }),
  );
}

function getDefaultCodexSettings(): CodexSettings {
  return {
    promptTemplate: DEFAULT_CODEX_PROMPT_TEMPLATE,
    projectPath: "",
  };
}

function getSharedStateCacheKey(shareId: string) {
  return `${SHARED_STATE_CACHE_KEY_PREFIX}${shareId}`;
}

function readTrueMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue === true),
  ) as Record<string, boolean>;
}

function readDailyIssue(value: unknown): DailyIssue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const issue = value as Record<string, unknown>;
  if (
    typeof issue.date !== "string" ||
    !ISSUE_DATE_PATTERN.test(issue.date) ||
    typeof issue.title !== "string" ||
    typeof issue.permalink !== "string" ||
    typeof issue.pubDate !== "string" ||
    !Array.isArray(issue.posts)
  ) {
    return null;
  }

  return {
    date: issue.date,
    title: issue.title,
    permalink: issue.permalink,
    pubDate: issue.pubDate,
    posts: issue.posts
      .map(readHnPost)
      .filter((post): post is HnPost => Boolean(post)),
  };
}

function readHnPost(value: unknown): HnPost | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const post = value as Record<string, unknown>;
  if (
    typeof post.id !== "string" ||
    !POST_ID_PATTERN.test(post.id) ||
    typeof post.title !== "string" ||
    typeof post.originalUrl !== "string" ||
    typeof post.hnCommentsUrl !== "string"
  ) {
    return null;
  }

  return {
    id: post.id,
    title: post.title,
    originalUrl: post.originalUrl,
    hnCommentsUrl: post.hnCommentsUrl,
  };
}
