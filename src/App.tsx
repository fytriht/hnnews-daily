import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpenCheck,
  CheckCircle2,
  ExternalLink,
  MessageCircle,
  RefreshCw,
  RotateCcw,
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

  const unreadCount = useMemo(
    () => issues.filter((issue) => !readState[issue.date]).length,
    [issues, readState],
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
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <BookOpenCheck size={20} />
          </span>
          <div>
            <h1>HN Daily Codex Reader</h1>
            <p>Daily Hacker News queue with one-click Codex summaries</p>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="status-chip" aria-label={`${unreadCount} unread issues`}>
            <span>{unreadCount}</span>
            unread
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => void loadIssues()}
            disabled={loadState === "loading"}
            aria-label="Refresh feed"
            title="Refresh feed"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="issue-rail" aria-label="Recent daily issues">
          <div className="rail-heading">
            <span>Latest 7 days</span>
            <strong>{issues.length || "--"}</strong>
          </div>

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
                  <span className="issue-meta">
                    <strong>{issue.posts.length}</strong>
                    stories
                  </span>
                  <span className="read-indicator">
                    {readState[issue.date] ? (
                      <>
                        <CheckCircle2 size={15} />
                        Read
                      </>
                    ) : (
                      "Unread"
                    )}
                  </span>
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
          <div className="detail-kicker">{formatWeekday(issue.date)} edition</div>
          <h2>{issue.title}</h2>
          <p>
            {issue.posts.length} top stories from Hacker News Daily. Selecting a
            day marks it as read on this device.
          </p>
        </div>

        <button
          className="secondary-button"
          type="button"
          onClick={onMarkUnread}
          disabled={!isRead}
        >
          <RotateCcw size={16} />
          Mark unread
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
                title="Open original article"
              >
                <ExternalLink size={16} />
                Original
              </a>
              <a
                className="action-link"
                href={post.hnCommentsUrl}
                target="_blank"
                rel="noreferrer"
                title="Open Hacker News comments"
              >
                <MessageCircle size={16} />
                HN
              </a>
              <a
                className="codex-button"
                href={buildCodexSummarizeUrl(post.originalUrl, post.hnCommentsUrl)}
                title="Open a Codex thread with the summarize prompt"
              >
                <Sparkles size={16} />
                Codex summarize
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
      {Array.from({ length: 7 }).map((_, index) => (
        <div className="issue-row skeleton" key={index}>
          <span />
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
