interface Env {
  SHARED_READ_STATE: KVNamespace;
  OPENROUTER_API_KEY?: string;
}

interface SummaryPayload {
  postId?: unknown;
  title?: unknown;
  originalUrl?: unknown;
  hnCommentsUrl?: unknown;
  promptTemplate?: unknown;
}

interface ValidatedSummaryPayload {
  postId: string;
  title: string;
  originalUrl: string;
  hnCommentsUrl: string;
  promptTemplate: string;
}

interface CachedSummary {
  summary: string;
  model: string;
  generatedAt: string;
}

interface OpenRouterStreamChunk {
  choices?: Array<{
    delta?: {
      content?: unknown;
    };
    message?: {
      content?: unknown;
    };
  }>;
  error?: {
    message?: unknown;
  };
}

const MODEL = "deepseek/deepseek-v4-flash";
const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions";
const POST_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-\d+$/;
const MAX_TITLE_LENGTH = 300;
const MAX_PROMPT_TEMPLATE_LENGTH = 2400;
const MAX_REQUEST_BYTES = 12_000;
const SUMMARY_CACHE_TTL_SECONDS = 60 * 60 * 24 * 90;
const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_TTL_SECONDS = 60 * 60 * 2;
const CACHED_STREAM_MIN_CHUNK_SIZE = 14;
const CACHED_STREAM_MAX_CHUNK_SIZE = 42;
const CACHED_STREAM_MIN_DELAY_MS = 18;
const CACHED_STREAM_MAX_DELAY_MS = 48;
const CACHED_STREAM_SENTENCE_PAUSE_MS = 28;
const CACHED_STREAM_PARAGRAPH_PAUSE_MS = 72;
const CACHED_STREAM_INITIAL_DELAY_MS = 90;
const STREAM_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  if (!env.SHARED_READ_STATE) {
    return createErrorStream("Summary storage is not configured.", 500);
  }

  const payloadResult = await readSummaryPayload(request);
  if (!payloadResult.ok) {
    return createErrorStream(payloadResult.error, 400);
  }

  const payload = payloadResult.value;
  const prompt = renderPromptTemplate(payload.promptTemplate, payload);
  const cacheKey = await createSummaryCacheKey(payload, prompt);
  const cached = await readCachedSummary(env.SHARED_READ_STATE, cacheKey);

  if (cached) {
    return createCachedSummaryStream(cached, request.signal);
  }

  if (!env.OPENROUTER_API_KEY) {
    return createErrorStream("OpenRouter API key is not configured.", 500);
  }

  const rateLimitResult = await checkRateLimit(env.SHARED_READ_STATE, request);
  if (!rateLimitResult.ok) {
    return createErrorStream(rateLimitResult.error, 429);
  }

  return createOpenRouterSummaryStream({
    apiKey: env.OPENROUTER_API_KEY,
    cacheKey,
    kv: env.SHARED_READ_STATE,
    origin: new URL(request.url).origin,
    payload,
    prompt,
    signal: request.signal,
  });
};

async function readSummaryPayload(
  request: Request,
): Promise<
  | { ok: true; value: ValidatedSummaryPayload }
  | { ok: false; error: string }
> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return { ok: false, error: "Summary request is too large." };
  }

  let parsed: unknown;

  try {
    parsed = await request.json();
  } catch {
    return { ok: false, error: "Request body must be valid JSON." };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const payload = parsed as SummaryPayload;
  const postId = readRequiredString(payload.postId, "postId");
  const title = readRequiredString(payload.title, "title");
  const originalUrl = readRequiredString(payload.originalUrl, "originalUrl");
  const hnCommentsUrl = readRequiredString(
    payload.hnCommentsUrl,
    "hnCommentsUrl",
  );
  const promptTemplate = readOptionalString(payload.promptTemplate);

  if (!postId.ok) {
    return postId;
  }

  if (!POST_ID_PATTERN.test(postId.value)) {
    return { ok: false, error: "postId is invalid." };
  }

  if (!title.ok) {
    return title;
  }

  if (title.value.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: "title is too long." };
  }

  if (!originalUrl.ok) {
    return originalUrl;
  }

  if (!isPublicHttpUrl(originalUrl.value)) {
    return { ok: false, error: "originalUrl must be an HTTP URL." };
  }

  if (!hnCommentsUrl.ok) {
    return hnCommentsUrl;
  }

  if (!isHackerNewsCommentsUrl(hnCommentsUrl.value)) {
    return { ok: false, error: "hnCommentsUrl must be a Hacker News URL." };
  }

  if (promptTemplate.length > MAX_PROMPT_TEMPLATE_LENGTH) {
    return { ok: false, error: "promptTemplate is too long." };
  }

  return {
    ok: true,
    value: {
      postId: postId.value,
      title: title.value,
      originalUrl: originalUrl.value,
      hnCommentsUrl: hnCommentsUrl.value,
      promptTemplate,
    },
  };
}

function readRequiredString(
  value: unknown,
  fieldName: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: `${fieldName} is required.` };
  }

  return { ok: true, value: value.trim() };
}

function readOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isPublicHttpUrl(value: string) {
  try {
    const url = new URL(value);

    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isHackerNewsCommentsUrl(value: string) {
  try {
    const url = new URL(value);

    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.hostname === "news.ycombinator.com"
    );
  } catch {
    return false;
  }
}

function renderPromptTemplate(
  promptTemplate: string,
  payload: Record<"title" | "originalUrl" | "hnCommentsUrl", string>,
) {
  const template = promptTemplate.trim()
    ? promptTemplate
    : "总结 {originalUrl} {hnCommentsUrl}";

  return template
    .split("{title}")
    .join(payload.title)
    .split("{originalUrl}")
    .join(payload.originalUrl)
    .split("{hnCommentsUrl}")
    .join(payload.hnCommentsUrl);
}

async function createSummaryCacheKey(
  payload: Record<"postId" | "title" | "originalUrl" | "hnCommentsUrl", string>,
  prompt: string,
) {
  const digest = await sha256Hex(
    JSON.stringify({
      model: MODEL,
      postId: payload.postId,
      title: payload.title,
      originalUrl: payload.originalUrl,
      hnCommentsUrl: payload.hnCommentsUrl,
      prompt,
    }),
  );

  return `summary:v1:${digest}`;
}

async function readCachedSummary(kv: KVNamespace, cacheKey: string) {
  try {
    return await kv.get<CachedSummary>(cacheKey, "json");
  } catch {
    return null;
  }
}

async function checkRateLimit(
  kv: KVNamespace,
  request: Request,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clientIp =
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  const clientHash = await sha256Hex(clientIp);
  const key = `summary-rate:v1:${hourBucket}:${clientHash}`;
  const currentCount = Number((await kv.get(key)) ?? "0");

  if (Number.isFinite(currentCount) && currentCount >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      ok: false,
      error: "AI summary limit reached. Please try again later.",
    };
  }

  await kv.put(key, String((Number.isFinite(currentCount) ? currentCount : 0) + 1), {
    expirationTtl: RATE_LIMIT_TTL_SECONDS,
  });

  return { ok: true };
}

function createCachedSummaryStream(cached: CachedSummary, signal: AbortSignal) {
  return createEventStream(async (controller) => {
    enqueueEvent(controller, "meta", {
      cached: true,
      generatedAt: cached.generatedAt,
      model: cached.model,
    });

    await wait(CACHED_STREAM_INITIAL_DELAY_MS);

    const chunks = chunkText(cached.summary);

    for (let index = 0; index < chunks.length; index += 1) {
      if (signal.aborted) {
        controller.close();
        return;
      }

      const chunk = chunks[index];
      enqueueEvent(controller, "delta", { text: chunk });

      if (index < chunks.length - 1) {
        await wait(readCachedStreamDelay(chunk));
      }
    }

    enqueueEvent(controller, "done", {});
    controller.close();
  });
}

function createOpenRouterSummaryStream({
  apiKey,
  cacheKey,
  kv,
  origin,
  payload,
  prompt,
  signal,
}: {
  apiKey: string;
  cacheKey: string;
  kv: KVNamespace;
  origin: string;
  payload: Record<"title" | "originalUrl" | "hnCommentsUrl", string>;
  prompt: string;
  signal: AbortSignal;
}) {
  return createEventStream(async (controller) => {
    const generatedAt = new Date().toISOString();
    const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": origin,
        "X-Title": "Hacker News Daily",
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages: [
          {
            role: "system",
            content:
              "You summarize Hacker News posts for a Chinese reader. Fetch and read the provided article URL and Hacker News comments URL before answering. Write concise, useful Chinese.",
          },
          {
            role: "user",
            content: buildSummaryPrompt(payload, prompt),
          },
        ],
        tools: [
          {
            type: "openrouter:web_fetch",
            parameters: {
              max_uses: 4,
              max_content_tokens: 100000,
              blocked_domains: ["localhost", "127.0.0.1", "0.0.0.0", "::1"],
            },
          },
        ],
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      enqueueEvent(controller, "error", {
        message: await readOpenRouterError(response),
      });
      controller.close();
      return;
    }

    enqueueEvent(controller, "meta", {
      cached: false,
      generatedAt,
      model: MODEL,
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let summary = "";
    let streamDone = false;

    while (!streamDone) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const messages = splitSseMessages(buffer);
      buffer = messages.remainder;

      for (const message of messages.complete) {
        const chunkResult = readOpenRouterStreamMessage(message);

        if (chunkResult.type === "done") {
          streamDone = true;
          break;
        }

        if (chunkResult.type === "error") {
          enqueueEvent(controller, "error", { message: chunkResult.message });
          controller.close();
          return;
        }

        if (chunkResult.text) {
          summary += chunkResult.text;
          enqueueEvent(controller, "delta", { text: chunkResult.text });
        }
      }
    }

    if (!streamDone && buffer.trim()) {
      const chunkResult = readOpenRouterStreamMessage(buffer);

      if (chunkResult.type === "error") {
        enqueueEvent(controller, "error", { message: chunkResult.message });
        controller.close();
        return;
      }

      if (chunkResult.type === "done") {
        streamDone = true;
      } else if (chunkResult.text) {
        summary += chunkResult.text;
        enqueueEvent(controller, "delta", { text: chunkResult.text });
      }
    }

    const trimmedSummary = summary.trim();
    if (!trimmedSummary) {
      enqueueEvent(controller, "error", {
        message: "OpenRouter returned an empty summary.",
      });
      controller.close();
      return;
    }

    await kv.put(
      cacheKey,
      JSON.stringify({
        summary: trimmedSummary,
        model: MODEL,
        generatedAt,
      } satisfies CachedSummary),
      { expirationTtl: SUMMARY_CACHE_TTL_SECONDS },
    );

    enqueueEvent(controller, "done", {});
    controller.close();
  });
}

function buildSummaryPrompt(
  payload: Record<"title" | "originalUrl" | "hnCommentsUrl", string>,
  renderedPrompt: string,
) {
  return [
    `标题：${payload.title}`,
    `原文链接：${payload.originalUrl}`,
    `HN 评论链接：${payload.hnCommentsUrl}`,
    "",
    "请按用户模板完成总结。若模板没有指定格式，请输出：",
    "1. 核心内容",
    "2. 关键观点或争议",
    "3. 适合谁阅读",
    "",
    `用户模板：${renderedPrompt}`,
  ].join("\n");
}

async function readOpenRouterError(response: Response) {
  try {
    const text = await response.text();

    if (!text.trim()) {
      return `OpenRouter request failed with status ${response.status}.`;
    }

    const data = JSON.parse(text) as { error?: { message?: unknown } };
    if (typeof data.error?.message === "string" && data.error.message.trim()) {
      return data.error.message;
    }

    return text.trim().slice(0, 300);
  } catch {
    return `OpenRouter request failed with status ${response.status}.`;
  }
}

function readOpenRouterStreamMessage(
  message: string,
):
  | { type: "chunk"; text: string }
  | { type: "done" }
  | { type: "error"; message: string } {
  const dataLines = message
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart());

  if (dataLines.length === 0) {
    return { type: "chunk", text: "" };
  }

  const data = dataLines.join("\n");
  if (data === "[DONE]") {
    return { type: "done" };
  }

  try {
    const parsed = JSON.parse(data) as OpenRouterStreamChunk;
    const errorMessage = parsed.error?.message;

    if (typeof errorMessage === "string" && errorMessage.trim()) {
      return { type: "error", message: errorMessage };
    }

    const text =
      parsed.choices
        ?.map((choice) => {
          const deltaContent = choice.delta?.content;
          const messageContent = choice.message?.content;

          return typeof deltaContent === "string"
            ? deltaContent
            : typeof messageContent === "string"
              ? messageContent
              : "";
        })
        .join("") ?? "";

    return { type: "chunk", text };
  } catch {
    return { type: "chunk", text: "" };
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

function createErrorStream(message: string, status: number) {
  return createEventStream((controller) => {
    enqueueEvent(controller, "error", { message });
    controller.close();
  }, status);
}

function createEventStream(
  start:
    | ((controller: ReadableStreamDefaultController<Uint8Array>) => void)
    | ((controller: ReadableStreamDefaultController<Uint8Array>) => Promise<void>),
  status = 200,
) {
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          await start(controller);
        } catch (error) {
          enqueueEvent(controller, "error", {
            message:
              error instanceof Error
                ? error.message
                : "Unable to summarize this post.",
          });
          controller.close();
        }
      },
    }),
    {
      status,
      headers: STREAM_HEADERS,
    },
  );
}

function enqueueEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: unknown,
) {
  controller.enqueue(
    new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
  );
}

function chunkText(text: string) {
  const characters = Array.from(text);
  const chunks: string[] = [];
  let index = 0;

  while (index < characters.length) {
    const targetEnd = Math.min(
      index +
        randomInteger(
          CACHED_STREAM_MIN_CHUNK_SIZE,
          CACHED_STREAM_MAX_CHUNK_SIZE,
        ),
      characters.length,
    );
    const chunkEnd = findNaturalChunkEnd(characters, index, targetEnd);

    chunks.push(characters.slice(index, chunkEnd).join(""));
    index = chunkEnd;
  }

  return chunks;
}

function findNaturalChunkEnd(
  characters: string[],
  startIndex: number,
  targetEnd: number,
) {
  const minimumEnd = Math.min(
    startIndex + CACHED_STREAM_MIN_CHUNK_SIZE,
    characters.length,
  );
  const maximumEnd = Math.min(
    startIndex + CACHED_STREAM_MAX_CHUNK_SIZE,
    characters.length,
  );

  if (targetEnd >= characters.length) {
    return characters.length;
  }

  for (let index = targetEnd; index < maximumEnd; index += 1) {
    if (isNaturalBreakCharacter(characters[index])) {
      return index + 1;
    }
  }

  for (let index = targetEnd - 1; index >= minimumEnd; index -= 1) {
    if (isNaturalBreakCharacter(characters[index])) {
      return index + 1;
    }
  }

  return targetEnd;
}

function isNaturalBreakCharacter(character: string | undefined) {
  return Boolean(character?.match(/[\s,.;:!?，。；：！？、)）\]】"'”’]/));
}

function readCachedStreamDelay(chunk: string) {
  let delay = randomInteger(
    CACHED_STREAM_MIN_DELAY_MS,
    CACHED_STREAM_MAX_DELAY_MS,
  );

  if (chunk.endsWith("\n\n")) {
    delay += CACHED_STREAM_PARAGRAPH_PAUSE_MS;
  } else if (/[.!?。！？]\s*$/.test(chunk)) {
    delay += CACHED_STREAM_SENTENCE_PAUSE_MS;
  }

  return delay;
}

function randomInteger(minimum: number, maximum: number) {
  return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
