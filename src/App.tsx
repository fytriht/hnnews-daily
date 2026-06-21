import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Github,
  Info,
  MailOpen,
  RefreshCw,
  RotateCcw,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
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
  writeStoredCodexSettings,
  writeStoredReadState,
  writeStoredSelectedDate,
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
  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    readStoredSelectedDate(),
  );
  const [readState, setReadState] = useState<ReadState>(() =>
    readStoredReadState(),
  );
  const [codexSettings, setCodexSettings] = useState<CodexSettings>(() =>
    readStoredCodexSettings(),
  );
  const [isCodexSettingsOpen, setIsCodexSettingsOpen] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);

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

  const handleToggleCodexSettings = useCallback(() => {
    setIsCodexSettingsOpen((isOpen) => !isOpen);
  }, []);

  const loadIssues = useCallback(async () => {
    setLoadState("loading");
    setError(null);

    try {
      const nextIssues = await fetchDailyIssues();
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
              codexSettings={codexSettings}
              isCodexSettingsOpen={isCodexSettingsOpen}
              onMarkUnread={() => markIssue(selectedIssue.date, false)}
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
  codexSettings: CodexSettings;
  isCodexSettingsOpen: boolean;
  onMarkUnread: () => void;
  onCodexSettingsChange: (settings: CodexSettings) => void;
  onToggleCodexSettings: () => void;
}

function IssueDetail({
  issue,
  isRead,
  codexSettings,
  isCodexSettingsOpen,
  onMarkUnread,
  onCodexSettingsChange,
  onToggleCodexSettings,
}: IssueDetailProps) {
  return (
    <>
      <div className="detail-header">
        <div>
          <time dateTime={issue.date}>{formatHeadingDate(issue.date)}</time>
          <h2>Hacker News Daily</h2>
        </div>

        <div className="detail-actions">
          <button
            className="icon-button quiet-button"
            type="button"
            onClick={onMarkUnread}
            disabled={!isRead}
            aria-label="Mark selected issue unread"
            title="Mark unread"
          >
            <MailOpen size={16} />
          </button>
          <button
            className={`icon-button quiet-button ${
              isCodexSettingsOpen ? "active" : ""
            }`}
            type="button"
            onClick={onToggleCodexSettings}
            aria-expanded={isCodexSettingsOpen}
            aria-controls="codex-settings-dialog"
            aria-label="Codex settings"
            title="Codex settings"
          >
            <Settings size={16} />
          </button>
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
          <li className="post-row" key={post.id}>
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
              <a
                className="summarize-link"
                href={buildCodexSummarizeUrl(
                  post.originalUrl,
                  post.hnCommentsUrl,
                  codexSettings,
                )}
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
        <button
          className="icon-button quiet-button"
          type="button"
          onClick={onClose}
          aria-label="Close Codex settings"
          title="Close"
        >
          <X size={16} />
        </button>
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
        <button
          className="secondary-button"
          type="button"
          onClick={resetSettings}
          title="Reset Codex settings"
        >
          <RotateCcw size={14} />
          Reset
        </button>
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
      <button
        className="primary-button"
        type="button"
        onClick={() => void onRetry()}
      >
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
