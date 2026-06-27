import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  Check,
  Copy,
  Github,
  Info,
  MailOpen,
  RotateCw,
  RotateCcw,
  Settings,
  Share2,
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
  buildSharedStateUrl,
  createSharedState,
  loadSharedState,
  patchSharedState,
  readSharedStateIdFromUrl,
  type SharedStatePatch,
  type SharedStateSnapshot,
} from "./sharedState";
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
type SharedSyncStatus = "local" | "loading" | "syncing" | "synced" | "error";

const MIN_REFRESH_SPIN_MS = 1000;
const SHARED_SYNC_DEBOUNCE_MS = 600;
const SHARED_REFRESH_INTERVAL_MS = 30000;

interface PendingSharedStatePatch {
  readState: ReadState;
  summarizedPosts: SummarizedPostState;
}

function createEmptySharedPatch(): PendingSharedStatePatch {
  return {
    readState: {},
    summarizedPosts: {},
  };
}

function hasSharedPatch(patch: SharedStatePatch) {
  return (
    Object.keys(patch.readState ?? {}).length > 0 ||
    Object.keys(patch.summarizedPosts ?? {}).length > 0
  );
}

function mergeSharedPatch(
  target: PendingSharedStatePatch,
  patch: SharedStatePatch,
) {
  Object.assign(target.readState, patch.readState);
  Object.assign(target.summarizedPosts, patch.summarizedPosts);
}

function consumeSharedPatch(
  target: MutableRefObject<PendingSharedStatePatch>,
) {
  const patch = target.current;
  target.current = createEmptySharedPatch();

  return patch;
}

export function App() {
  const [shareId, setShareId] = useState<string | null>(() =>
    readSharedStateIdFromUrl(),
  );
  const [issues, setIssues] = useState<DailyIssue[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    readStoredSelectedDate(),
  );
  const [readState, setReadState] = useState<ReadState>(() =>
    readSharedStateIdFromUrl() ? {} : readStoredReadState(),
  );
  const readStateRef = useRef(readState);
  const [summarizedPosts, setSummarizedPosts] = useState<SummarizedPostState>(
    () => (readSharedStateIdFromUrl() ? {} : readStoredSummarizedPosts()),
  );
  const summarizedPostsRef = useRef(summarizedPosts);
  const [codexSettings, setCodexSettings] = useState<CodexSettings>(() =>
    readStoredCodexSettings(),
  );
  const [isCodexSettingsOpen, setIsCodexSettingsOpen] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isSharedStateReady, setIsSharedStateReady] = useState(() => !shareId);
  const [sharedSyncStatus, setSharedSyncStatus] =
    useState<SharedSyncStatus>(() => (shareId ? "loading" : "local"));
  const [sharedSyncError, setSharedSyncError] = useState<string | null>(null);
  const [sharedNotice, setSharedNotice] = useState<string | null>(() =>
    shareId ? "Loading shared read state..." : null,
  );
  const [isCreatingShare, setIsCreatingShare] = useState(false);
  const [isShareLinkCopied, setIsShareLinkCopied] = useState(false);
  const issuesRef = useRef<DailyIssue[]>([]);
  const isLoadingRef = useRef(false);
  const pendingSharedPatchRef = useRef<PendingSharedStatePatch>(
    createEmptySharedPatch(),
  );
  const sharedPatchTimerRef = useRef<number | null>(null);
  const isSharedPatchInFlightRef = useRef(false);
  const needsSharedPatchFlushRef = useRef(false);
  const flushSharedPatchRef = useRef<() => Promise<void>>(async () => {});
  const shareCopiedTimerRef = useRef<number | null>(null);

  const selectedIssue = useMemo(
    () =>
      issues.find((issue) => issue.date === selectedDate) ?? issues[0] ?? null,
    [issues, selectedDate],
  );
  const selectedIssueDate = selectedIssue?.date ?? null;

  const applySharedSnapshot = useCallback((snapshot: SharedStateSnapshot) => {
    readStateRef.current = snapshot.readState;
    summarizedPostsRef.current = snapshot.summarizedPosts;
    setReadState(snapshot.readState);
    setSummarizedPosts(snapshot.summarizedPosts);
  }, []);

  const scheduleSharedPatchFlush = useCallback(
    (delay = SHARED_SYNC_DEBOUNCE_MS) => {
      if (sharedPatchTimerRef.current !== null) {
        window.clearTimeout(sharedPatchTimerRef.current);
      }

      sharedPatchTimerRef.current = window.setTimeout(() => {
        sharedPatchTimerRef.current = null;
        void flushSharedPatchRef.current();
      }, delay);
    },
    [],
  );

  const flushSharedPatch = useCallback(async () => {
    if (!shareId) {
      return;
    }

    if (isSharedPatchInFlightRef.current) {
      needsSharedPatchFlushRef.current = true;
      return;
    }

    const patch = consumeSharedPatch(pendingSharedPatchRef);
    if (!hasSharedPatch(patch)) {
      setSharedSyncStatus("synced");
      return;
    }

    isSharedPatchInFlightRef.current = true;
    setSharedSyncStatus("syncing");
    setSharedSyncError(null);

    try {
      await patchSharedState(shareId, patch);
    } catch (syncError) {
      mergeSharedPatch(pendingSharedPatchRef.current, patch);
      setSharedSyncStatus("error");
      setSharedSyncError(
        syncError instanceof Error
          ? syncError.message
          : "Unable to sync shared state.",
      );
      return;
    } finally {
      isSharedPatchInFlightRef.current = false;
    }

    if (
      needsSharedPatchFlushRef.current ||
      hasSharedPatch(pendingSharedPatchRef.current)
    ) {
      needsSharedPatchFlushRef.current = false;
      scheduleSharedPatchFlush(0);
      return;
    }

    setSharedSyncStatus("synced");
    setSharedNotice("Shared read state is up to date.");
  }, [scheduleSharedPatchFlush, shareId]);

  useEffect(() => {
    flushSharedPatchRef.current = flushSharedPatch;
  }, [flushSharedPatch]);

  const queueSharedPatch = useCallback(
    (patch: SharedStatePatch) => {
      if (!shareId) {
        return;
      }

      mergeSharedPatch(pendingSharedPatchRef.current, patch);
      setSharedSyncStatus("syncing");
      setSharedSyncError(null);
      scheduleSharedPatchFlush();
    },
    [scheduleSharedPatchFlush, shareId],
  );

  const loadSharedSnapshot = useCallback(
    async ({ initial = false, silent = false } = {}) => {
      if (!shareId) {
        return;
      }

      if (
        isSharedPatchInFlightRef.current ||
        hasSharedPatch(pendingSharedPatchRef.current)
      ) {
        return;
      }

      if (initial) {
        setIsSharedStateReady(false);
      }
      if (!silent) {
        setSharedSyncStatus("loading");
      }
      setSharedSyncError(null);

      try {
        const snapshot = await loadSharedState(shareId);

        if (
          isSharedPatchInFlightRef.current ||
          hasSharedPatch(pendingSharedPatchRef.current)
        ) {
          return;
        }

        applySharedSnapshot(snapshot);
        setIsSharedStateReady(true);
        setSharedSyncStatus("synced");
        setSharedNotice(
          "Shared read state is active. Anyone with this link can update it.",
        );
      } catch (loadError) {
        setSharedSyncStatus("error");
        setSharedSyncError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load shared state.",
        );
        if (initial) {
          setSharedNotice(
            "Shared read state could not be loaded. Retry before relying on this link.",
          );
        }
      }
    },
    [applySharedSnapshot, shareId],
  );

  const handleRetrySharedSync = useCallback(() => {
    if (!shareId) {
      return;
    }

    if (hasSharedPatch(pendingSharedPatchRef.current)) {
      void flushSharedPatchRef.current();
      return;
    }

    void loadSharedSnapshot();
  }, [loadSharedSnapshot, shareId]);

  const copySharedLink = useCallback(async (id: string) => {
    const url = buildSharedStateUrl(id);

    try {
      await navigator.clipboard.writeText(url);
      setIsShareLinkCopied(true);
      setSharedNotice("Shared link copied. Open it on another device to share progress.");

      if (shareCopiedTimerRef.current !== null) {
        window.clearTimeout(shareCopiedTimerRef.current);
      }
      shareCopiedTimerRef.current = window.setTimeout(() => {
        setIsShareLinkCopied(false);
        shareCopiedTimerRef.current = null;
      }, 2200);
    } catch {
      setSharedNotice(`Shared link is ready in the address bar: ${url}`);
    }
  }, []);

  const handleShareReadState = useCallback(async () => {
    if (shareId) {
      await copySharedLink(shareId);
      return;
    }

    setIsCreatingShare(true);
    setSharedSyncStatus("syncing");
    setSharedSyncError(null);
    setSharedNotice("Creating shared link...");

    try {
      const id = await createSharedState({
        readState: readStateRef.current,
        summarizedPosts: summarizedPostsRef.current,
      });
      const url = buildSharedStateUrl(id);

      window.history.replaceState(null, "", url);
      setIsSharedStateReady(false);
      setShareId(id);
      setSharedSyncStatus("synced");
      setSharedNotice(
        "Shared link created. Open this URL on another device to share read and summary status.",
      );
      await copySharedLink(id);
    } catch (shareError) {
      setSharedSyncStatus("error");
      setSharedSyncError(
        shareError instanceof Error
          ? shareError.message
          : "Unable to create shared link.",
      );
      setSharedNotice("Shared link could not be created. You can retry.");
    } finally {
      setIsCreatingShare(false);
    }
  }, [copySharedLink, shareId]);

  const markIssue = useCallback(
    (date: string, isRead: boolean) => {
      const current = readStateRef.current;

      if (Boolean(current[date]) === isRead) {
        return;
      }

      const next = { ...current };

      if (isRead) {
        next[date] = true;
      } else {
        delete next[date];
      }

      readStateRef.current = next;
      setReadState(next);

      if (shareId) {
        queueSharedPatch({ readState: { [date]: isRead } });
        return;
      }

      writeStoredReadState(next);
    },
    [queueSharedPatch, shareId],
  );

  const handleCodexSettingsChange = useCallback((settings: CodexSettings) => {
    setCodexSettings(settings);
    writeStoredCodexSettings(settings);
  }, []);

  const markPostSummarized = useCallback(
    (postId: string) => {
      if (summarizedPostsRef.current[postId]) {
        return;
      }

      const next = {
        ...summarizedPostsRef.current,
        [postId]: true,
      };

      summarizedPostsRef.current = next;
      setSummarizedPosts(next);

      if (shareId) {
        queueSharedPatch({ summarizedPosts: { [postId]: true } });
        return;
      }

      writeStoredSummarizedPosts(next);
    },
    [queueSharedPatch, shareId],
  );

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
    if (!shareId) {
      setIsSharedStateReady(true);
      setSharedSyncStatus("local");
      setSharedSyncError(null);
      pendingSharedPatchRef.current = createEmptySharedPatch();
      return;
    }

    pendingSharedPatchRef.current = createEmptySharedPatch();
    needsSharedPatchFlushRef.current = false;

    if (sharedPatchTimerRef.current !== null) {
      window.clearTimeout(sharedPatchTimerRef.current);
      sharedPatchTimerRef.current = null;
    }

    void loadSharedSnapshot({ initial: true });
  }, [loadSharedSnapshot, shareId]);

  useEffect(() => {
    if (!shareId) {
      return;
    }

    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadSharedSnapshot({ silent: true });
      }
    }, SHARED_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(refreshInterval);
    };
  }, [loadSharedSnapshot, shareId]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadIssues();
        void loadSharedSnapshot({ silent: true });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadIssues, loadSharedSnapshot]);

  useEffect(() => {
    return () => {
      if (sharedPatchTimerRef.current !== null) {
        window.clearTimeout(sharedPatchTimerRef.current);
      }
      if (shareCopiedTimerRef.current !== null) {
        window.clearTimeout(shareCopiedTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (loadState !== "loaded") {
      return;
    }

    writeStoredSelectedDate(selectedIssueDate);
  }, [loadState, selectedIssueDate]);

  useEffect(() => {
    if (!selectedIssueDate || !isSharedStateReady) {
      return;
    }

    markIssue(selectedIssueDate, true);
  }, [isSharedStateReady, markIssue, selectedIssueDate]);

  const handleRefresh = useCallback(() => {
    void loadIssues();
    void loadSharedSnapshot();
  }, [loadIssues, loadSharedSnapshot]);

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
              shareId={shareId}
              sharedSyncStatus={sharedSyncStatus}
              sharedSyncError={sharedSyncError}
              sharedNotice={sharedNotice}
              isCreatingShare={isCreatingShare}
              isShareLinkCopied={isShareLinkCopied}
              onRefresh={handleRefresh}
              onMarkUnread={() => markIssue(selectedIssue.date, false)}
              onMarkPostSummarized={markPostSummarized}
              onCodexSettingsChange={handleCodexSettingsChange}
              onToggleCodexSettings={handleToggleCodexSettings}
              onShareReadState={() => void handleShareReadState()}
              onRetrySharedSync={handleRetrySharedSync}
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
  shareId: string | null;
  sharedSyncStatus: SharedSyncStatus;
  sharedSyncError: string | null;
  sharedNotice: string | null;
  isCreatingShare: boolean;
  isShareLinkCopied: boolean;
  onRefresh: () => void;
  onMarkUnread: () => void;
  onMarkPostSummarized: (postId: string) => void;
  onCodexSettingsChange: (settings: CodexSettings) => void;
  onToggleCodexSettings: () => void;
  onShareReadState: () => void;
  onRetrySharedSync: () => void;
}

function IssueDetail({
  issue,
  isRead,
  isLoading,
  summarizedPosts,
  codexSettings,
  isCodexSettingsOpen,
  shareId,
  sharedSyncStatus,
  sharedSyncError,
  sharedNotice,
  isCreatingShare,
  isShareLinkCopied,
  onRefresh,
  onMarkUnread,
  onMarkPostSummarized,
  onCodexSettingsChange,
  onToggleCodexSettings,
  onShareReadState,
  onRetrySharedSync,
}: IssueDetailProps) {
  const refreshLabel = isLoading ? "Refreshing feed" : "Refresh feed";
  const shareLabel = shareId ? "Copy shared link" : "Create shared link";

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
          <Button
            onClick={onShareReadState}
            disabled={isCreatingShare}
            aria-label={shareLabel}
            title={shareLabel}
          >
            {isShareLinkCopied ? <Check size={16} /> : <Share2 size={16} />}
          </Button>
        </div>
      </div>

      <CodexSettingsDialog
        isOpen={isCodexSettingsOpen}
        settings={codexSettings}
        onChange={onCodexSettingsChange}
        onClose={onToggleCodexSettings}
      />

      <SharedStatePanel
        shareId={shareId}
        status={sharedSyncStatus}
        error={sharedSyncError}
        notice={sharedNotice}
        isCreatingShare={isCreatingShare}
        isShareLinkCopied={isShareLinkCopied}
        onShare={onShareReadState}
        onRetry={onRetrySharedSync}
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

interface SharedStatePanelProps {
  shareId: string | null;
  status: SharedSyncStatus;
  error: string | null;
  notice: string | null;
  isCreatingShare: boolean;
  isShareLinkCopied: boolean;
  onShare: () => void;
  onRetry: () => void;
}

function SharedStatePanel({
  shareId,
  status,
  error,
  notice,
  isCreatingShare,
  isShareLinkCopied,
  onShare,
  onRetry,
}: SharedStatePanelProps) {
  const isShared = Boolean(shareId);
  const actionLabel = isShared
    ? isShareLinkCopied
      ? "Copied"
      : "Copy link"
    : isCreatingShare
      ? "Creating"
      : "Create link";

  return (
    <section
      className={isShared ? "shared-state-panel active" : "shared-state-panel"}
      aria-live="polite"
    >
      <div className="shared-state-content">
        <div className="shared-state-title-row">
          {isShared ? (
            <span className="shared-state-pill">Shared</span>
          ) : null}
          <h3>
            {isShared
              ? "Shared progress is on"
              : "Share progress across devices"}
          </h3>
        </div>
        <p>
          {notice ??
            (isShared
              ? "Devices using this URL share read and summary status."
              : "Create a short link, then open it anywhere to share read and summary status.")}
        </p>
        {error ? <p className="shared-state-error">{error}</p> : null}
      </div>
      <div className="shared-state-actions">
        {isShared ? (
          <span className={`shared-state-status ${status}`}>
            {formatSharedSyncStatus(status)}
          </span>
        ) : null}
        {error && isShared ? (
          <Button variant="outline" onClick={onRetry}>
            <RotateCw size={14} />
            Retry
          </Button>
        ) : null}
        <Button
          variant="outline"
          onClick={onShare}
          disabled={isCreatingShare}
          title={isShared ? "Copy shared link" : "Create shared link"}
        >
          {isShareLinkCopied ? <Check size={14} /> : <Copy size={14} />}
          {actionLabel}
        </Button>
      </div>
    </section>
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

function formatSharedSyncStatus(status: SharedSyncStatus) {
  switch (status) {
    case "loading":
      return "Loading";
    case "syncing":
      return "Syncing";
    case "synced":
      return "Synced";
    case "error":
      return "Sync issue";
    case "local":
      return "Local";
  }
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
