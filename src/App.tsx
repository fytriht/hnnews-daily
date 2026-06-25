import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Github,
  Info,
  MailOpen,
  RotateCw,
  RotateCcw,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "./Button";
import {
  buildCodexSummarizeUrl,
  DEFAULT_CODEX_PROMPT_TEMPLATE,
  type CodexSettings,
} from "./codex";
import { fetchDailyIssues } from "./hnDaily";
import {
  readStoredCodexSettings,
  readStoredReadState,
  readStoredSelectedDate,
  readStoredSummarizedPosts,
  writeStoredCodexSettings,
  writeStoredReadState,
  writeStoredSelectedDate,
  writeStoredSummarizedPosts,
} from "./storage";
import type { DailyIssue, ReadState, SummarizedPostState } from "./types";

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
const MIN_REFRESH_SPIN_MS = 1000;

export function App() {
  const [issues, setIssues] = useState<DailyIssue[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    readStoredSelectedDate(),
  );
  const [readState, setReadState] = useState<ReadState>(() =>
    readStoredReadState(),
  );
  const [summarizedPosts, setSummarizedPosts] = useState<SummarizedPostState>(
    () => readStoredSummarizedPosts(),
  );
  const summarizedPostsRef = useRef(summarizedPosts);
  const [codexSettings, setCodexSettings] = useState<CodexSettings>(() =>
    readStoredCodexSettings(),
  );
  const [isCodexSettingsOpen, setIsCodexSettingsOpen] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const issuesRef = useRef<DailyIssue[]>([]);
  const isLoadingRef = useRef(false);

  const selectedIssue = useMemo(
    () =>
      issues.find((issue) => issue.date === selectedDate) ?? issues[0] ?? null,
    [issues, selectedDate],
  );
  const selectedIssueDate = selectedIssue?.date ?? null;

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

  const handleCodexSettingsChange = useCallback((settings: CodexSettings) => {
    setCodexSettings(settings);
    writeStoredCodexSettings(settings);
  }, []);

  const markPostSummarized = useCallback((postId: string) => {
    if (summarizedPostsRef.current[postId]) {
      return;
    }

    const next = {
      ...summarizedPostsRef.current,
      [postId]: true,
    };

    summarizedPostsRef.current = next;
    writeStoredSummarizedPosts(next);
    setSummarizedPosts(next);
  }, []);

  const handleToggleCodexSettings = useCallback(() => {
    setIsCodexSettingsOpen((isOpen) => !isOpen);
  }, []);

  const loadIssues = useCallback(async () => {
    if (isLoadingRef.current) {
      return;
    }

    isLoadingRef.current = true;
    const hadIssues = issuesRef.current.length > 0;
    const loadStartedAt = Date.now();

    setLoadState("loading");
    setError(null);

    try {
      const nextIssues = await fetchDailyIssues();
      issuesRef.current = nextIssues;
      setIssues(nextIssues);
      setSelectedDate((current) => {
        const storedDate = readStoredSelectedDate();
        const candidateDate = current ?? storedDate;

        if (
          candidateDate &&
          nextIssues.some((issue) => issue.date === candidateDate)
        ) {
          return candidateDate;
        }

        return nextIssues[0]?.date ?? null;
      });
      await waitForMinimumLoadingTime(loadStartedAt, hadIssues);
      setLoadState("loaded");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load HN Daily feed.",
      );
      await waitForMinimumLoadingTime(loadStartedAt, hadIssues);
      setLoadState(hadIssues ? "loaded" : "error");
    } finally {
      isLoadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void loadIssues();
  }, [loadIssues]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadIssues();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadIssues]);

  useEffect(() => {
    if (loadState !== "loaded") {
      return;
    }

    writeStoredSelectedDate(selectedIssueDate);
  }, [loadState, selectedIssueDate]);

  useEffect(() => {
    if (!selectedIssueDate) {
      return;
    }

    markIssue(selectedIssueDate, true);
  }, [markIssue, selectedIssueDate]);

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
              isLoading={loadState === "loading"}
              summarizedPosts={summarizedPosts}
              codexSettings={codexSettings}
              isCodexSettingsOpen={isCodexSettingsOpen}
              onRefresh={() => void loadIssues()}
              onMarkUnread={() => markIssue(selectedIssue.date, false)}
              onMarkPostSummarized={markPostSummarized}
              onCodexSettingsChange={handleCodexSettingsChange}
              onToggleCodexSettings={handleToggleCodexSettings}
            />
          ) : (
            <EmptyState />
          )}
        </section>
      </section>
      <footer className="project-footer">
        <a
          className="project-link"
          href="https://github.com/fytriht/hnnews-daily"
          target="_blank"
          rel="noreferrer"
          aria-label="Open GitHub project"
          title="GitHub project"
        >
          <Github size={13} aria-hidden="true" />
          GitHub
        </a>
      </footer>
    </main>
  );
}

interface IssueDetailProps {
  issue: DailyIssue;
  isRead: boolean;
  isLoading: boolean;
  summarizedPosts: SummarizedPostState;
  codexSettings: CodexSettings;
  isCodexSettingsOpen: boolean;
  onRefresh: () => void;
  onMarkUnread: () => void;
  onMarkPostSummarized: (postId: string) => void;
  onCodexSettingsChange: (settings: CodexSettings) => void;
  onToggleCodexSettings: () => void;
}

function IssueDetail({
  issue,
  isRead,
  isLoading,
  summarizedPosts,
  codexSettings,
  isCodexSettingsOpen,
  onRefresh,
  onMarkUnread,
  onMarkPostSummarized,
  onCodexSettingsChange,
  onToggleCodexSettings,
}: IssueDetailProps) {
  const refreshLabel = isLoading ? "Refreshing feed" : "Refresh feed";

  return (
    <>
      <div className="detail-header">
        <div>
          <time dateTime={issue.date}>{formatHeadingDate(issue.date)}</time>
          <h2>Hacker News Daily</h2>
        </div>

        <div className="detail-actions">
          <Button
            onClick={onRefresh}
            disabled={isLoading}
            aria-label={refreshLabel}
            title={refreshLabel}
          >
            <RotateCw
              className={isLoading ? "refresh-icon loading" : "refresh-icon"}
              size={16}
            />
          </Button>
          <Button
            onClick={onMarkUnread}
            disabled={!isRead}
            aria-label="Mark selected issue unread"
            title="Mark unread"
          >
            <MailOpen size={16} />
          </Button>
          <Button
            onClick={onToggleCodexSettings}
            aria-expanded={isCodexSettingsOpen}
            aria-controls="codex-settings-dialog"
            aria-label="Codex settings"
            title="Codex settings"
          >
            <Settings size={16} />
          </Button>
        </div>
      </div>

      <CodexSettingsDialog
        isOpen={isCodexSettingsOpen}
        settings={codexSettings}
        onChange={onCodexSettingsChange}
        onClose={onToggleCodexSettings}
      />

      <ol className="post-list">
        {issue.posts.map((post, index) => (
          <li
            className={
              summarizedPosts[post.id] ? "post-row summarized" : "post-row"
            }
            key={post.id}
          >
            <span className="post-rank">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="post-main">
              <h3>
                <a
                  className="post-title-link"
                  href={post.hnCommentsUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open Hacker News comments: ${post.title}`}
                  title="Open Hacker News comments"
                >
                  {post.title}
                </a>
              </h3>
              <a
                className="post-domain-link"
                href={post.originalUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open original article: ${post.title}`}
                title="Open original article"
              >
                {getDomain(post.originalUrl)}
              </a>
            </div>
            <div className="post-actions">
              <Button
                href={buildCodexSummarizeUrl(
                  post.originalUrl,
                  post.hnCommentsUrl,
                  codexSettings,
                )}
                title="Summarize with Codex"
                onClick={() => onMarkPostSummarized(post.id)}
              >
                <Sparkles size={16} />
                Summarize
              </Button>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

interface CodexSettingsDialogProps {
  isOpen: boolean;
  settings: CodexSettings;
  onChange: (settings: CodexSettings) => void;
  onClose: () => void;
}

function CodexSettingsDialog({
  isOpen,
  settings,
  onChange,
  onClose,
}: CodexSettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    if (isOpen && !dialog.open) {
      dialog.showModal();
      return;
    }

    if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  const updatePromptTemplate = (promptTemplate: string) => {
    onChange({
      ...settings,
      promptTemplate,
    });
  };
  const updateProjectPath = (projectPath: string) => {
    onChange({
      ...settings,
      projectPath,
    });
  };
  const resetSettings = () => {
    onChange({
      promptTemplate: DEFAULT_CODEX_PROMPT_TEMPLATE,
      projectPath: "",
    });
  };

  return (
    <dialog
      className="settings-dialog"
      id="codex-settings-dialog"
      ref={dialogRef}
      aria-labelledby="codex-settings-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="settings-dialog-header">
        <h2 id="codex-settings-title">Settings</h2>
        <Button
          onClick={onClose}
          aria-label="Close Codex settings"
          title="Close"
        >
          <X size={16} />
        </Button>
      </div>

      <div className="settings-dialog-body">
        <div className="settings-field">
          <label className="settings-label" htmlFor="codex-prompt-template">
            <span>Prompt template</span>
            <span
              className="settings-tooltip"
              tabIndex={0}
              title="Builds the Codex prompt. Use {originalUrl} and {hnCommentsUrl} to insert the article and comments links."
              aria-label="Builds the Codex prompt. Use originalUrl and hnCommentsUrl placeholders to insert the article and comments links."
            >
              <Info size={13} aria-hidden="true" />
            </span>
          </label>
          <textarea
            id="codex-prompt-template"
            value={settings.promptTemplate}
            rows={4}
            spellCheck={false}
            onChange={(event) =>
              updatePromptTemplate(event.currentTarget.value)
            }
            onBlur={(event) => {
              if (!event.currentTarget.value.trim()) {
                updatePromptTemplate(DEFAULT_CODEX_PROMPT_TEMPLATE);
              }
            }}
          />
        </div>
        <div className="settings-field">
          <label className="settings-label" htmlFor="codex-project-path">
            <span>Project path</span>
            <span
              className="settings-tooltip"
              tabIndex={0}
              title="Optional project path passed to Codex. Leave blank to open the new thread outside a project."
              aria-label="Optional project path passed to Codex. Leave blank to open the new thread outside a project."
            >
              <Info size={13} aria-hidden="true" />
            </span>
          </label>
          <input
            id="codex-project-path"
            type="text"
            value={settings.projectPath}
            placeholder="/Users/name/project"
            spellCheck={false}
            onChange={(event) => updateProjectPath(event.currentTarget.value)}
            onBlur={(event) => {
              const projectPath = event.currentTarget.value.trim();
              if (projectPath !== settings.projectPath) {
                updateProjectPath(projectPath);
              }
            }}
          />
        </div>
      </div>

      <div className="settings-dialog-footer">
        <Button
          variant="outline"
          onClick={resetSettings}
          title="Reset Codex settings"
        >
          <RotateCcw size={14} />
          Reset
        </Button>
      </div>
    </dialog>
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
      <Button onClick={() => void onRetry()}>
        <RotateCw size={16} />
        Try again
      </Button>
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

function waitForMinimumLoadingTime(startedAt: number, shouldWait: boolean) {
  if (!shouldWait) {
    return Promise.resolve();
  }

  const remainingMs = MIN_REFRESH_SPIN_MS - (Date.now() - startedAt);

  if (remainingMs <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, remainingMs);
  });
}
