import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  Check,
  CircleStop,
  Copy,
  Github,
  Info,
  Mail,
  MailOpen,
  RotateCw,
  RotateCcw,
  Settings,
  Share2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamPostSummary, type SummaryMeta } from "./aiSummary";
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
  readStoredDailyIssues,
  readStoredReadState,
  readStoredSelectedDate,
  readStoredSharedStateSnapshot,
  readStoredSummarizedPosts,
  writeStoredCodexSettings,
  writeStoredDailyIssues,
  writeStoredReadState,
  writeStoredSelectedDate,
  writeStoredSharedStateSnapshot,
  writeStoredSummarizedPosts,
} from "./storage";
import type {
  DailyIssue,
  HnPost,
  ReadState,
  SummarizedPostState,
} from "./types";

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
type IssueSource = "generated" | "cache" | "remote";
type SharedSyncStatus = "local" | "loading" | "syncing" | "synced" | "error";

const MIN_REFRESH_SPIN_MS = 1000;
const ISSUE_PLACEHOLDER_COUNT = 10;
const SHARED_SYNC_DEBOUNCE_MS = 600;
const SHARED_REFRESH_INTERVAL_MS = 30000;

interface PendingSharedStatePatch {
  readState: ReadState;
  summarizedPosts: SummarizedPostState;
}

interface InitialSharedState {
  shareId: string | null;
  snapshot: SharedStateSnapshot | null;
}

interface InitialIssueState {
  issues: DailyIssue[];
  source: IssueSource;
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

function consumeSharedPatch(target: MutableRefObject<PendingSharedStatePatch>) {
  const patch = target.current;
  target.current = createEmptySharedPatch();

  return patch;
}

function readInitialSharedState(): InitialSharedState {
  const shareId = readSharedStateIdFromUrl();

  return {
    shareId,
    snapshot: shareId ? readStoredSharedStateSnapshot(shareId) : null,
  };
}

function readInitialIssues(): InitialIssueState {
  const cachedIssues = readStoredDailyIssues();

  if (cachedIssues.length > 0) {
    return {
      issues: cachedIssues,
      source: "cache",
    };
  }

  return {
    issues: createLocalIssuePlaceholders(),
    source: "generated",
  };
}

function createLocalIssuePlaceholders(): DailyIssue[] {
  const latestIssueDate = new Date();
  latestIssueDate.setUTCHours(0, 0, 0, 0);
  latestIssueDate.setUTCDate(latestIssueDate.getUTCDate() - 1);

  return Array.from({ length: ISSUE_PLACEHOLDER_COUNT }, (_, index) => {
    const issueDate = new Date(latestIssueDate);
    issueDate.setUTCDate(latestIssueDate.getUTCDate() - index);
    const date = formatIssueDate(issueDate);

    return {
      date,
      title: `Daily Hacker News for ${date}`,
      permalink: "",
      pubDate: "",
      posts: [],
    };
  });
}

function formatIssueDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function App() {
  const [initialSharedState] = useState(() => readInitialSharedState());
  const [initialIssueState] = useState(() => readInitialIssues());
  const [shareId, setShareId] = useState<string | null>(
    initialSharedState.shareId,
  );
  const [issues, setIssues] = useState<DailyIssue[]>(initialIssueState.issues);
  const [issueSource, setIssueSource] = useState<IssueSource>(
    initialIssueState.source,
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    readStoredSelectedDate(),
  );
  const [readState, setReadState] = useState<ReadState>(
    () =>
      initialSharedState.snapshot?.readState ??
      (initialSharedState.shareId ? {} : readStoredReadState()),
  );
  const readStateRef = useRef(readState);
  const [summarizedPosts, setSummarizedPosts] = useState<SummarizedPostState>(
    () =>
      initialSharedState.snapshot?.summarizedPosts ??
      (initialSharedState.shareId ? {} : readStoredSummarizedPosts()),
  );
  const summarizedPostsRef = useRef(summarizedPosts);
  const [codexSettings, setCodexSettings] = useState<CodexSettings>(() =>
    readStoredCodexSettings(),
  );
  const [isCodexSettingsOpen, setIsCodexSettingsOpen] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [isSharedStateReady, setIsSharedStateReady] = useState(
    () => !initialSharedState.shareId || Boolean(initialSharedState.snapshot),
  );
  const [sharedSyncStatus, setSharedSyncStatus] = useState<SharedSyncStatus>(
    () => (shareId ? "loading" : "local"),
  );
  const [sharedSyncError, setSharedSyncError] = useState<string | null>(null);
  const [sharedNotice, setSharedNotice] = useState<string | null>(() =>
    initialSharedState.shareId
      ? initialSharedState.snapshot
        ? "Refreshing shared read state..."
        : "Loading shared read state..."
      : null,
  );
  const [isCreatingShare, setIsCreatingShare] = useState(false);
  const [isShareLinkCopied, setIsShareLinkCopied] = useState(false);
  const issuesRef = useRef<DailyIssue[]>(initialIssueState.issues);
  const isLoadingRef = useRef(false);
  const pendingSharedPatchRef = useRef<PendingSharedStatePatch>(
    createEmptySharedPatch(),
  );
  const sharedPatchTimerRef = useRef<number | null>(null);
  const isSharedPatchInFlightRef = useRef(false);
  const needsSharedPatchFlushRef = useRef(false);
  const flushSharedPatchRef = useRef<() => Promise<void>>(async () => {});

  const selectedIssue = useMemo(
    () =>
      issues.find((issue) => issue.date === selectedDate) ?? issues[0] ?? null,
    [issues, selectedDate],
  );
  const selectedIssueDate = selectedIssue?.date ?? null;
  const hasIssueContent = issueSource !== "generated";
  const isSharedStateKnown = !shareId || isSharedStateReady;
  const isIssueReadStateKnown = hasIssueContent && isSharedStateKnown;

  const applySharedSnapshot = useCallback(
    (snapshot: SharedStateSnapshot) => {
      readStateRef.current = snapshot.readState;
      summarizedPostsRef.current = snapshot.summarizedPosts;
      setReadState(snapshot.readState);
      setSummarizedPosts(snapshot.summarizedPosts);
      if (shareId) {
        writeStoredSharedStateSnapshot(shareId, snapshot);
      }
    },
    [shareId],
  );

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

    setIsShareLinkCopied(true);
    setSharedNotice(
      "Shared link copied. Open it on another device to share progress.",
    );

    try {
      await navigator.clipboard.writeText(url);
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
    setIsShareLinkCopied(false);
    setSharedSyncStatus("syncing");
    setSharedSyncError(null);
    setSharedNotice("Creating shared link...");

    try {
      const snapshot = {
        readState: readStateRef.current,
        summarizedPosts: summarizedPostsRef.current,
      };
      const id = await createSharedState(snapshot);
      const url = buildSharedStateUrl(id);

      window.history.replaceState(null, "", url);
      writeStoredSharedStateSnapshot(id, snapshot);
      setIsSharedStateReady(true);
      setShareId(id);
      setSharedSyncStatus("synced");
      setSharedNotice(
        "Shared link created. Open this URL on another device to share read and summary status.",
      );
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
        writeStoredSharedStateSnapshot(shareId, {
          readState: next,
          summarizedPosts: summarizedPostsRef.current,
        });
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
        writeStoredSharedStateSnapshot(shareId, {
          readState: readStateRef.current,
          summarizedPosts: next,
        });
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

  const handleToggleShareDialog = useCallback(() => {
    setIsShareDialogOpen((isOpen) => !isOpen);
  }, []);

  const loadIssues = useCallback(async () => {
    if (isLoadingRef.current) {
      return;
    }

    isLoadingRef.current = true;
    const hadIssueContent = issuesRef.current.some(
      (issue) => issue.posts.length > 0,
    );
    const loadStartedAt = Date.now();

    setLoadState("loading");
    setError(null);

    try {
      const nextIssues = await fetchDailyIssues();
      issuesRef.current = nextIssues;
      writeStoredDailyIssues(nextIssues);
      setIssues(nextIssues);
      setIssueSource("remote");
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
      await waitForMinimumLoadingTime(loadStartedAt, hadIssueContent);
      setLoadState("loaded");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load HN Daily feed.",
      );
      await waitForMinimumLoadingTime(loadStartedAt, hadIssueContent);
      setLoadState(hadIssueContent ? "loaded" : "error");
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
    };
  }, []);

  useEffect(() => {
    if (loadState !== "loaded") {
      return;
    }

    writeStoredSelectedDate(selectedIssueDate);
  }, [loadState, selectedIssueDate]);

  useEffect(() => {
    if (!selectedIssueDate || !hasIssueContent || !isSharedStateReady) {
      return;
    }

    markIssue(selectedIssueDate, true);
  }, [hasIssueContent, isSharedStateReady, markIssue, selectedIssueDate]);

  const handleRefresh = useCallback(() => {
    void loadIssues();
    void loadSharedSnapshot();
  }, [loadIssues, loadSharedSnapshot]);

  const handleSelectIssue = (issue: DailyIssue) => {
    setSelectedDate(issue.date);
    if (isIssueReadStateKnown) {
      markIssue(issue.date, true);
    }
  };

  return (
    <main className="app-shell">
      <section className="workspace">
        <aside className="issue-rail" aria-label="Recent 10 daily issues">
          <div className="issue-list">
            {issues.map((issue) => {
              const isIssueRead = Boolean(readState[issue.date]);
              const readStateClass = isIssueReadStateKnown
                ? isIssueRead
                  ? "read"
                  : "unread"
                : "pending";

              return (
                <button
                  key={issue.date}
                  type="button"
                  className={`issue-row ${
                    selectedIssue?.date === issue.date ? "selected" : ""
                  } ${readStateClass}`}
                  onClick={() => handleSelectIssue(issue)}
                >
                  <span className="issue-date">
                    {formatDate(issue.date)}
                    <small>{formatWeekday(issue.date)}</small>
                  </span>
                  {isIssueReadStateKnown && !isIssueRead ? (
                    <span className="read-dot" aria-label="Unread issue" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </aside>

        <section className="detail-pane" aria-live="polite">
          {loadState === "error" ? (
            <ErrorState message={error} onRetry={loadIssues} />
          ) : selectedIssue && !hasIssueContent ? (
            <IssueDetailLoading issue={selectedIssue} />
          ) : selectedIssue ? (
            <IssueDetail
              issue={selectedIssue}
              isRead={
                isIssueReadStateKnown && Boolean(readState[selectedIssue.date])
              }
              isSharedStateKnown={isIssueReadStateKnown}
              isLoading={loadState === "loading"}
              summarizedPosts={summarizedPosts}
              codexSettings={codexSettings}
              isCodexSettingsOpen={isCodexSettingsOpen}
              isShareDialogOpen={isShareDialogOpen}
              shareId={shareId}
              sharedSyncStatus={sharedSyncStatus}
              sharedSyncError={sharedSyncError}
              sharedNotice={sharedNotice}
              isCreatingShare={isCreatingShare}
              isShareLinkCopied={isShareLinkCopied}
              onRefresh={handleRefresh}
              onToggleReadState={() =>
                markIssue(selectedIssue.date, !readState[selectedIssue.date])
              }
              onMarkPostSummarized={markPostSummarized}
              onCodexSettingsChange={handleCodexSettingsChange}
              onToggleCodexSettings={handleToggleCodexSettings}
              onToggleShareDialog={handleToggleShareDialog}
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
  isSharedStateKnown: boolean;
  isLoading: boolean;
  summarizedPosts: SummarizedPostState;
  codexSettings: CodexSettings;
  isCodexSettingsOpen: boolean;
  isShareDialogOpen: boolean;
  shareId: string | null;
  sharedSyncStatus: SharedSyncStatus;
  sharedSyncError: string | null;
  sharedNotice: string | null;
  isCreatingShare: boolean;
  isShareLinkCopied: boolean;
  onRefresh: () => void;
  onToggleReadState: () => void;
  onMarkPostSummarized: (postId: string) => void;
  onCodexSettingsChange: (settings: CodexSettings) => void;
  onToggleCodexSettings: () => void;
  onToggleShareDialog: () => void;
  onShareReadState: () => void;
  onRetrySharedSync: () => void;
}

type PostSummaryStatus =
  | "loading"
  | "streaming"
  | "done"
  | "error"
  | "stopped";

interface PostSummaryState {
  status: PostSummaryStatus;
  text: string;
  error: string | null;
  meta: SummaryMeta | null;
  isExpanded: boolean;
}

function IssueDetail({
  issue,
  isRead,
  isSharedStateKnown,
  isLoading,
  summarizedPosts,
  codexSettings,
  isCodexSettingsOpen,
  isShareDialogOpen,
  shareId,
  sharedSyncStatus,
  sharedSyncError,
  sharedNotice,
  isCreatingShare,
  isShareLinkCopied,
  onRefresh,
  onToggleReadState,
  onMarkPostSummarized,
  onCodexSettingsChange,
  onToggleCodexSettings,
  onToggleShareDialog,
  onShareReadState,
  onRetrySharedSync,
}: IssueDetailProps) {
  const [postSummaryStates, setPostSummaryStates] = useState<
    Record<string, PostSummaryState>
  >({});
  const postSummaryAbortControllersRef = useRef<
    Record<string, AbortController>
  >({});
  const refreshLabel = isLoading ? "Refreshing feed" : "Refresh feed";
  const readToggleLabel = !isSharedStateKnown
    ? "Read status loading"
    : isRead
      ? "Mark selected issue unread"
      : "Mark selected issue read";
  const readToggleTitle = !isSharedStateKnown
    ? "Read status loading"
    : isRead
      ? "Mark unread"
      : "Mark read";
  const shareLabel = shareId ? "Shared progress" : "Share progress";
  const togglePostSummary = useCallback((postId: string) => {
    setPostSummaryStates((current) => {
      const summaryState = current[postId];

      if (!summaryState) {
        return current;
      }

      return {
        ...current,
        [postId]: {
          ...summaryState,
          isExpanded: !summaryState.isExpanded,
        },
      };
    });
  }, []);
  const summarizePost = useCallback(
    async (post: HnPost) => {
      postSummaryAbortControllersRef.current[post.id]?.abort();

      const abortController = new AbortController();
      let summaryText = "";

      postSummaryAbortControllersRef.current[post.id] = abortController;
      setPostSummaryStates((current) => ({
        ...current,
        [post.id]: {
          status: "loading",
          text: "",
          error: null,
          meta: null,
          isExpanded: true,
        },
      }));

      try {
        await streamPostSummary(
          post.id,
          codexSettings.promptTemplate,
          {
            onMeta: (meta) => {
              setPostSummaryStates((current) => ({
                ...current,
                [post.id]: {
                  ...(current[post.id] ?? {
                    text: "",
                    error: null,
                    isExpanded: true,
                  }),
                  status: "streaming",
                  meta,
                },
              }));
            },
            onDelta: (text) => {
              summaryText += text;
              setPostSummaryStates((current) => {
                const previous = current[post.id];

                return {
                  ...current,
                  [post.id]: {
                    status: previous?.status ?? "streaming",
                    text: `${previous?.text ?? ""}${text}`,
                    error: null,
                    meta: previous?.meta ?? null,
                    isExpanded: previous?.isExpanded ?? true,
                  },
                };
              });
            },
            onDone: () => {
              setPostSummaryStates((current) => {
                const previous = current[post.id];

                return {
                  ...current,
                  [post.id]: {
                    status: "done",
                    text: previous?.text ?? summaryText,
                    error: null,
                    meta: previous?.meta ?? null,
                    isExpanded: true,
                  },
                };
              });
            },
          },
          abortController.signal,
        );

        if (summaryText.trim()) {
          onMarkPostSummarized(post.id);
        }
      } catch (summaryError) {
        if (abortController.signal.aborted) {
          return;
        }

        setPostSummaryStates((current) => {
          const previous = current[post.id];

          return {
            ...current,
            [post.id]: {
              status: "error",
              text: previous?.text ?? summaryText,
              error:
                summaryError instanceof Error
                  ? summaryError.message
                  : "Unable to summarize this post.",
              meta: previous?.meta ?? null,
              isExpanded: true,
            },
          };
        });
      } finally {
        if (
          postSummaryAbortControllersRef.current[post.id] === abortController
        ) {
          delete postSummaryAbortControllersRef.current[post.id];
        }
      }
    },
    [codexSettings.promptTemplate, onMarkPostSummarized],
  );
  const stopPostSummary = useCallback((postId: string) => {
    const abortController = postSummaryAbortControllersRef.current[postId];

    if (!abortController) {
      return;
    }

    abortController.abort();
    delete postSummaryAbortControllersRef.current[postId];
    setPostSummaryStates((current) => {
      const previous = current[postId];

      if (
        !previous ||
        (previous.status !== "loading" && previous.status !== "streaming")
      ) {
        return current;
      }

      return {
        ...current,
        [postId]: {
          status: "stopped",
          text: previous.text,
          error: null,
          meta: previous.meta,
          isExpanded: true,
        },
      };
    });
  }, []);

  useEffect(() => {
    const abortControllers = postSummaryAbortControllersRef.current;

    return () => {
      Object.values(abortControllers).forEach((abortController) =>
        abortController.abort(),
      );
    };
  }, []);

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
            onClick={onToggleReadState}
            disabled={!isSharedStateKnown}
            aria-pressed={isSharedStateKnown ? isRead : undefined}
            aria-label={readToggleLabel}
            title={readToggleTitle}
          >
            {isRead ? <MailOpen size={16} /> : <Mail size={16} />}
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
            onClick={onToggleShareDialog}
            disabled={isCreatingShare}
            aria-expanded={isShareDialogOpen}
            aria-controls="shared-state-dialog"
            aria-label={shareLabel}
            title={shareLabel}
          >
            <Share2 size={16} />
          </Button>
        </div>
      </div>

      <CodexSettingsDialog
        isOpen={isCodexSettingsOpen}
        settings={codexSettings}
        onChange={onCodexSettingsChange}
        onClose={onToggleCodexSettings}
      />

      <SharedStateDialog
        isOpen={isShareDialogOpen}
        shareId={shareId}
        status={sharedSyncStatus}
        error={sharedSyncError}
        notice={sharedNotice}
        isCreatingShare={isCreatingShare}
        isShareLinkCopied={isShareLinkCopied}
        onShare={onShareReadState}
        onRetry={onRetrySharedSync}
        onClose={onToggleShareDialog}
      />

      <ol className="post-list">
        {issue.posts.map((post, index) => {
          const isPostSummarized =
            isSharedStateKnown && Boolean(summarizedPosts[post.id]);
          const summaryState = postSummaryStates[post.id];
          const isSummaryLoading =
            summaryState?.status === "loading" ||
            summaryState?.status === "streaming";
          const hasSummaryResult =
            summaryState?.status === "done" &&
            Boolean(summaryState.text.trim());
          const canToggleSummary =
            hasSummaryResult ||
            summaryState?.status === "error" ||
            summaryState?.status === "stopped";
          const summaryPanelId = `post-summary-${post.id}`;
          const summaryButtonTitle = isSummaryLoading
            ? "Stop AI Summary"
            : canToggleSummary
              ? summaryState.isExpanded
                ? "Collapse AI Summary"
                : "Expand AI Summary"
              : "AI Summary";
          const summaryButtonLabel = isSummaryLoading
            ? `Stop AI Summary: ${post.title}`
            : canToggleSummary
              ? summaryState.isExpanded
                ? `Collapse AI Summary: ${post.title}`
                : `Expand AI Summary: ${post.title}`
              : `Generate AI Summary: ${post.title}`;
          const handleSummaryButtonClick = () => {
            if (isSummaryLoading) {
              stopPostSummary(post.id);
              return;
            }

            if (canToggleSummary) {
              togglePostSummary(post.id);
              return;
            }

            void summarizePost(post);
          };

          return (
            <li
              className={isPostSummarized ? "post-row summarized" : "post-row"}
              key={post.id}
            >
              <span className="post-rank">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="post-main">
                <h3>
                  <a
                    className="post-title-link"
                    href={post.originalUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open original article: ${post.title}`}
                    title="Open original article"
                  >
                    {post.title}
                  </a>
                </h3>
                <div className="post-links">
                  <a
                    className="post-meta-link"
                    href={post.originalUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open original article: ${post.title}`}
                    title="Open original article"
                  >
                    {getDomain(post.originalUrl)}
                  </a>
                  <a
                    className="post-meta-link"
                    href={post.hnCommentsUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open Hacker News comments: ${post.title}`}
                    title="Open Hacker News comments"
                  >
                    (comments)
                  </a>
                </div>
              </div>
              <div className="post-actions">
                <Button
                  variant="outline"
                  href={buildCodexSummarizeUrl(
                    post.originalUrl,
                    post.hnCommentsUrl,
                    codexSettings,
                    post.title,
                  )}
                  aria-label="Open in Codex"
                  title="Open in Codex"
                  onClick={() => onMarkPostSummarized(post.id)}
                >
                  <span className="codex-button-icon" aria-hidden="true" />
                </Button>
                <Button
                  variant="outline"
                  className="summary-button"
                  onClick={handleSummaryButtonClick}
                  aria-busy={isSummaryLoading || undefined}
                  aria-expanded={summaryState?.isExpanded ?? false}
                  aria-controls={summaryPanelId}
                  aria-label={summaryButtonLabel}
                  title={summaryButtonTitle}
                >
                  {isSummaryLoading ? (
                    <CircleStop size={14} />
                  ) : canToggleSummary && summaryState.isExpanded ? (
                    <ChevronUp size={14} />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                  {isSummaryLoading ? "Stop" : "AI Summary"}
                </Button>
              </div>
              {summaryState?.isExpanded ? (
                <div className="post-summary-slot expanded">
                  <PostSummaryPanel
                    id={summaryPanelId}
                    state={summaryState}
                    onRetry={() => void summarizePost(post)}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}

interface PostSummaryPanelProps {
  id: string;
  state: PostSummaryState;
  onRetry: () => void;
}

function PostSummaryPanel({
  id,
  state,
  onRetry,
}: PostSummaryPanelProps) {
  const isGenerating =
    state.status === "loading" || state.status === "streaming";
  const isStopped = state.status === "stopped";

  return (
    <div
      className={`post-summary-panel ${state.status}`}
      id={id}
      aria-live="polite"
    >
      {state.text ? (
        <div className="post-summary-text">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            allowedElements={[
              "a",
              "blockquote",
              "br",
              "code",
              "del",
              "em",
              "h1",
              "h2",
              "h3",
              "h4",
              "hr",
              "li",
              "ol",
              "p",
              "pre",
              "strong",
              "table",
              "tbody",
              "td",
              "th",
              "thead",
              "tr",
              "ul",
            ]}
            urlTransform={(url) => {
              if (/^(https?:|mailto:)/i.test(url)) {
                return url;
              }

              return "";
            }}
            components={{
              a: ({ children, href }) => (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {state.text}
          </ReactMarkdown>
        </div>
      ) : state.status === "error" ? null : (
        <div className="post-summary-placeholder">
          {isStopped
            ? "Summary generation stopped."
            : "Reading the article and HN comments..."}
        </div>
      )}

      {isGenerating ? (
        <div className="post-summary-action-row">
          <p>
            {state.status === "loading"
              ? "Starting summary generation..."
              : "Generating summary..."}
          </p>
        </div>
      ) : null}

      {isStopped ? (
        <div className="post-summary-action-row">
          <p>
            {state.text
              ? "Stopped before the summary finished."
              : "No summary was generated."}
          </p>
          <Button variant="outline" onClick={onRetry}>
            <RotateCw size={14} />
            Retry
          </Button>
        </div>
      ) : null}

      {state.error ? (
        <div className="post-summary-action-row error">
          <p>{state.error}</p>
          <Button variant="outline" onClick={onRetry}>
            <RotateCw size={14} />
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}

interface SharedStateDialogProps {
  isOpen: boolean;
  shareId: string | null;
  status: SharedSyncStatus;
  error: string | null;
  notice: string | null;
  isCreatingShare: boolean;
  isShareLinkCopied: boolean;
  onShare: () => void;
  onRetry: () => void;
  onClose: () => void;
}

function SharedStateDialog({
  isOpen,
  shareId,
  status,
  error,
  notice,
  isCreatingShare,
  isShareLinkCopied,
  onShare,
  onRetry,
  onClose,
}: SharedStateDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isShared = Boolean(shareId);
  const actionLabel = isShared
    ? isShareLinkCopied
      ? "Copied"
      : "Copy link"
    : isCreatingShare
      ? "Creating"
      : "Create link";
  const isActionDisabled = isCreatingShare || (isShared && isShareLinkCopied);

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

  const sharedUrl = shareId ? buildSharedStateUrl(shareId) : null;

  return (
    <dialog
      className="settings-dialog shared-state-dialog"
      id="shared-state-dialog"
      ref={dialogRef}
      aria-live="polite"
      aria-labelledby="shared-state-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="settings-dialog-header">
        <h2 id="shared-state-title">Shared progress</h2>
        <Button
          onClick={onClose}
          aria-label="Close shared progress"
          title="Close"
        >
          <X size={16} />
        </Button>
      </div>

      <div className="shared-state-dialog-body">
        <div className="shared-state-title-row">
          <h3>
            {isShared
              ? "Shared progress is on"
              : "Share progress across devices"}
          </h3>
          {isShared ? (
            <span className={`shared-state-status ${status}`}>
              {formatSharedSyncStatus(status)}
            </span>
          ) : null}
        </div>
        <p>
          {notice ??
            (isShared
              ? "Devices using this URL share read and summary status."
              : "Create a short link, then open it anywhere to share read and summary status.")}
        </p>
        {sharedUrl ? (
          <input
            className="shared-state-url-input"
            type="text"
            value={sharedUrl}
            readOnly
            aria-label="Shared link"
            onFocus={(event) => event.currentTarget.select()}
          />
        ) : null}
        {error ? <p className="shared-state-error">{error}</p> : null}
      </div>

      <div className="settings-dialog-footer shared-state-dialog-footer">
        {error && isShared ? (
          <Button variant="outline" onClick={onRetry}>
            <RotateCw size={14} />
            Retry
          </Button>
        ) : null}
        <Button
          variant="outline"
          onClick={onShare}
          disabled={isActionDisabled}
          title={isShared ? "Copy shared link" : "Create shared link"}
        >
          {isShareLinkCopied ? <Check size={14} /> : <Copy size={14} />}
          {actionLabel}
        </Button>
      </div>
    </dialog>
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

interface IssueDetailLoadingProps {
  issue: DailyIssue;
}

function IssueDetailLoading({ issue }: IssueDetailLoadingProps) {
  return (
    <>
      <div className="detail-header">
        <div>
          <time dateTime={issue.date}>{formatHeadingDate(issue.date)}</time>
          <h2>Hacker News Daily</h2>
        </div>

        <div className="detail-actions">
          <Button disabled aria-label="Loading feed" title="Loading feed">
            <RotateCw className="refresh-icon loading" size={16} />
          </Button>
        </div>
      </div>

      <ol className="post-list" aria-label="Loading posts">
        {Array.from({ length: 8 }).map((_, index) => (
          <li className="post-row skeleton" key={index}>
            <span className="post-rank">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="post-main">
              <span className="post-skeleton-line title" />
              <span className="post-skeleton-line domain" />
            </div>
            <div className="post-actions">
              <span className="post-skeleton-action" />
            </div>
          </li>
        ))}
      </ol>
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
