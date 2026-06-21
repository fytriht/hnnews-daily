import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  Mail,
  MessageCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { buildCodexSummarizeUrl } from "./codex";
import { fetchDailyIssues } from "./hnDaily";
import {
  readStoredReadState,
  writeStoredReadState,
} from "./storage";
import type { DailyIssue, ReadState } from "./types";

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "2-digit",
});

const weekdayFormatter = new Intl.DateTimeFormat("en", {
  weekday: "short",
});

const headingDateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

type LoadState = "idle" | "loading" | "loaded" | "error";

export function App() {
  const [issues, setIssues] = useState<DailyIssue[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [readState, setReadState] = useState<ReadState>(() => readStoredReadState());
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);

  const selectedIssue = useMemo(
    () => issues.find((issue) => issue.date === selectedDate) ?? issues[0] ?? null,
    [issues, selectedDate],
  );

  const markIssue = useCallback((date: string, isRead: boolean) => {
    setReadState((current) => {
      const next = { ...current };

      if (isRead) {
        next[date] = true;
      } else {
        delete next[date];
      }

      writeStoredReadState(next);
      return next;
    });
  }, []);

  const loadIssues = useCallback(async () => {
    setLoadState("loading");
    setError(null);

    try {
      const nextIssues = await fetchDailyIssues();
      setIssues(nextIssues);
      setSelectedDate((current) => {
        if (current && nextIssues.some((issue) => issue.date === current)) {
          return current;
        }

        return nextIssues[0]?.date ?? null;
      });
      setLoadState("loaded");
    } catch (loadError) {
      setLoadState("error");
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load HN Daily feed.",
      );
    }
  }, []);

  useEffect(() => {
    void loadIssues();
  }, [loadIssues]);

  const handleSelectIssue = (issue: DailyIssue) => {
    setSelectedDate(issue.date);
    markIssue(issue.date, true);
  };

  return (
    <main className="app-shell">
      <section className="workspace">
        <aside className="issue-rail" aria-label="Recent 10 daily issues">
          <div className="issue-list">
            {loadState === "loading" && issues.length === 0 ? (
              <IssueSkeleton />
            ) : (
              issues.map((issue) => (
                <button
                  key={issue.date}
                  type="button"
                  className={`issue-row ${
                    selectedIssue?.date === issue.date ? "selected" : ""
                  } ${readState[issue.date] ? "read" : "unread"}`}
                  onClick={() => handleSelectIssue(issue)}
                >
                  <span className="issue-date">
                    {formatDate(issue.date)}
                    <small>{formatWeekday(issue.date)}</small>
                  </span>
                  {!readState[issue.date] ? (
                    <span className="read-dot" aria-label="Unread issue" />
                  ) : null}
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="detail-pane" aria-live="polite">
          {loadState === "error" ? (
            <ErrorState message={error} onRetry={loadIssues} />
          ) : selectedIssue ? (
            <IssueDetail
              issue={selectedIssue}
              isRead={Boolean(readState[selectedIssue.date])}
              onMarkUnread={() => markIssue(selectedIssue.date, false)}
            />
          ) : (
            <EmptyState />
          )}
        </section>
      </section>
    </main>
  );
}

interface IssueDetailProps {
  issue: DailyIssue;
  isRead: boolean;
  onMarkUnread: () => void;
}

function IssueDetail({ issue, isRead, onMarkUnread }: IssueDetailProps) {
  return (
    <>
      <div className="detail-header">
        <div>
          <time dateTime={issue.date}>{formatHeadingDate(issue.date)}</time>
          <h2>Hacker News Daily</h2>
        </div>

        <button
          className="icon-button quiet-button"
          type="button"
          onClick={onMarkUnread}
          disabled={!isRead}
          aria-label="Mark selected issue unread"
          title="Mark unread"
        >
          <Mail size={16} />
        </button>
      </div>

      <ol className="post-list">
        {issue.posts.map((post, index) => (
          <li className="post-row" key={post.id}>
            <span className="post-rank">{String(index + 1).padStart(2, "0")}</span>
            <div className="post-main">
              <h3>{post.title}</h3>
              <div className="post-domain">{getDomain(post.originalUrl)}</div>
            </div>
            <div className="post-actions">
              <a
                className="action-link"
                href={post.originalUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open original article: ${post.title}`}
                title="Open original article"
              >
                <ExternalLink size={16} />
              </a>
              <a
                className="action-link"
                href={post.hnCommentsUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open Hacker News comments: ${post.title}`}
                title="Open Hacker News comments"
              >
                <MessageCircle size={16} />
              </a>
              <a
                className="summarize-link"
                href={buildCodexSummarizeUrl(post.originalUrl, post.hnCommentsUrl)}
                title="Summarize with Codex"
              >
                <Sparkles size={16} />
                Summarize
              </a>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function IssueSkeleton() {
  return (
    <>
      {Array.from({ length: 10 }).map((_, index) => (
        <div className="issue-row skeleton" key={index}>
          <span />
          <span />
        </div>
      ))}
    </>
  );
}

interface ErrorStateProps {
  message: string | null;
  onRetry: () => void;
}

function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="state-panel">
      <h2>Feed unavailable</h2>
      <p>{message ?? "The HN Daily RSS feed could not be loaded."}</p>
      <button className="primary-button" type="button" onClick={() => void onRetry()}>
        <RefreshCw size={16} />
        Try again
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="state-panel">
      <h2>No daily issues yet</h2>
      <p>Refresh the feed to load the latest Hacker News Daily entries.</p>
    </div>
  );
}

function formatDate(date: string) {
  return dateFormatter.format(parseDate(date));
}

function formatWeekday(date: string) {
  return weekdayFormatter.format(parseDate(date));
}

function formatHeadingDate(date: string) {
  return headingDateFormatter.format(parseDate(date));
}

function parseDate(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
