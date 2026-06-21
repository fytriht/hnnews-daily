import type { ReadState } from "./types";

const READ_STATE_KEY = "hn-daily-reader:read-days";
const SELECTED_DATE_KEY = "hn-daily-reader:selected-date";
const ISSUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
