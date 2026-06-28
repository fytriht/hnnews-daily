export interface SummaryMeta {
  cached: boolean;
  generatedAt: string;
  model: string;
}

interface SummaryStreamHandlers {
  onMeta: (meta: SummaryMeta) => void;
  onDelta: (text: string) => void;
  onDone: () => void;
}

interface SummaryStreamEvent {
  event: string;
  data: unknown;
}

const SUMMARY_ENDPOINT = "/api/summarize-post";

export async function streamPostSummary(
  postId: string,
  promptTemplate: string,
  handlers: SummaryStreamHandlers,
  signal: AbortSignal,
) {
  const response = await fetch(SUMMARY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      postId,
      promptTemplate,
    }),
    signal,
  });

  if (!response.body) {
    throw new Error("Summary stream is unavailable.");
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    throw new Error(await readNonStreamError(response));
  }

  await readSummaryStream(response.body, handlers);
}

async function readSummaryStream(
  body: ReadableStream<Uint8Array>,
  handlers: SummaryStreamHandlers,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let didFinish = false;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const messages = splitSseMessages(buffer);
    buffer = messages.remainder;

    for (const message of messages.complete) {
      if (handleSummaryEvent(parseSseMessage(message), handlers)) {
        didFinish = true;
      }
    }
  }

  if (buffer.trim()) {
    if (handleSummaryEvent(parseSseMessage(buffer), handlers)) {
      didFinish = true;
    }
  }

  if (!didFinish) {
    throw new Error("Summary stream ended before completion.");
  }
}

function handleSummaryEvent(
  streamEvent: SummaryStreamEvent,
  handlers: SummaryStreamHandlers,
): boolean {
  switch (streamEvent.event) {
    case "meta":
      if (isSummaryMeta(streamEvent.data)) {
        handlers.onMeta(streamEvent.data);
      }
      return false;
    case "delta":
      if (isDeltaEvent(streamEvent.data)) {
        handlers.onDelta(streamEvent.data.text);
      }
      return false;
    case "done":
      handlers.onDone();
      return true;
    case "error":
      throw new Error(readErrorMessage(streamEvent.data));
    default:
      return false;
  }
}

function splitSseMessages(buffer: string) {
  const complete: string[] = [];
  let remainder = buffer;
  let separatorIndex = remainder.search(/\r?\n\r?\n/);

  while (separatorIndex >= 0) {
    complete.push(remainder.slice(0, separatorIndex));
    const nextStart =
      remainder[separatorIndex] === "\r" &&
      remainder[separatorIndex + 1] === "\n"
        ? separatorIndex + 4
        : separatorIndex + 2;
    remainder = remainder.slice(nextStart);
    separatorIndex = remainder.search(/\r?\n\r?\n/);
  }

  return { complete, remainder };
}

function parseSseMessage(message: string): SummaryStreamEvent {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of message.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  return {
    event,
    data: parseJsonData(dataLines.join("\n")),
  };
}

function parseJsonData(value: string): unknown {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function isSummaryMeta(value: unknown): value is SummaryMeta {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as SummaryMeta).cached === "boolean" &&
    typeof (value as SummaryMeta).generatedAt === "string" &&
    typeof (value as SummaryMeta).model === "string"
  );
}

function isDeltaEvent(value: unknown): value is { text: string } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { text?: unknown }).text === "string"
  );
}

function readErrorMessage(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { message?: unknown }).message === "string" &&
    (value as { message: string }).message.trim()
  ) {
    return (value as { message: string }).message;
  }

  return "Unable to summarize this post.";
}

async function readNonStreamError(response: Response) {
  try {
    const text = await response.text();

    if (!text.trim()) {
      return `Summary request failed with status ${response.status}.`;
    }

    const data = JSON.parse(text) as { error?: unknown };
    if (typeof data.error === "string" && data.error.trim()) {
      return data.error;
    }

    return text.trim();
  } catch {
    return `Summary request failed with status ${response.status}.`;
  }
}
