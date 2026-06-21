import type { ReadState } from "./types";

const READ_STATE_KEY = "hn-daily-reader:read-days";

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
