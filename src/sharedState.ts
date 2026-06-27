import type { ReadState, SummarizedPostState } from "./types";

export interface SharedStateSnapshot {
  readState: ReadState;
  summarizedPosts: SummarizedPostState;
}

export interface SharedStatePatch {
  readState?: ReadState;
  summarizedPosts?: SummarizedPostState;
}

const SHARED_STATE_ID_PATTERN = /^[A-Za-z0-9]{10}$/;
const SHARED_STATE_PARAM = "share";

export function readSharedStateIdFromUrl() {
  const id = new URLSearchParams(window.location.search).get(
    SHARED_STATE_PARAM,
  );

  return id && SHARED_STATE_ID_PATTERN.test(id) ? id : null;
}

export function buildSharedStateUrl(id: string) {
  const url = new URL(window.location.href);
  url.searchParams.set(SHARED_STATE_PARAM, id);

  return url.toString();
}

export async function createSharedState(
  snapshot: SharedStateSnapshot,
): Promise<string> {
  const response = await fetch("/api/shared-state", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(snapshot),
  });
  const data = await readJsonResponse<{ id?: unknown; error?: unknown }>(
    response,
  );

  if (!response.ok || typeof data.id !== "string") {
    throw new Error(getResponseError(data, "Unable to create shared link."));
  }

  return data.id;
}

export async function loadSharedState(
  id: string,
): Promise<SharedStateSnapshot> {
  const response = await fetch(`/api/shared-state/${encodeURIComponent(id)}`, {
    headers: {
      Accept: "application/json",
    },
  });
  const data = await readJsonResponse<
    Partial<SharedStateSnapshot> & { error?: unknown }
  >(response);

  if (!response.ok) {
    throw new Error(getResponseError(data, "Unable to load shared state."));
  }

  return {
    readState: normalizeBooleanMap(data.readState),
    summarizedPosts: normalizeBooleanMap(data.summarizedPosts),
  };
}

export async function patchSharedState(id: string, patch: SharedStatePatch) {
  const response = await fetch(`/api/shared-state/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(patch),
  });
  const data = await readJsonResponse<{ error?: unknown }>(response);

  if (!response.ok) {
    throw new Error(getResponseError(data, "Unable to sync shared state."));
  }
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

function normalizeBooleanMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue === true),
  ) as Record<string, boolean>;
}

function getResponseError(
  data: { error?: unknown },
  fallbackMessage: string,
) {
  return typeof data.error === "string" && data.error.trim()
    ? data.error
    : fallbackMessage;
}
