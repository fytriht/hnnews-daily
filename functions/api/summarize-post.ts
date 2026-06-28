interface Env {
  SHARED_READ_STATE: KVNamespace;
  OPENROUTER_API_KEY?: string;
}

interface SummaryPayload {
  postId?: unknown;
  promptTemplate?: unknown;
}

interface ValidatedSummaryPayload {
  postId: string;
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
  }>;
  error?: {
    message?: unknown;
  };
}

interface CanonicalPost {
  postId: string;
  title: string;
  originalUrl: string;
  hnCommentsUrl: string;
}

const MODEL = "deepseek/deepseek-v4-flash";
const SUMMARY_PROMPT_VERSION = "v1";
const HN_DAILY_FEED_URL = "https://www.daemonology.net/hn-daily/index.rss";
const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions";
const POST_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-(?:[1-9]|10)$/;
const PROMPT_TEMPLATE_HARD_CODED_URL_PATTERN = /\bhttps?:\/\//i;
const MAX_PROMPT_TEMPLATE_LENGTH = 2400;
const MAX_REQUEST_BYTES = 12_000;
const MAX_HN_DAILY_FEED_BYTES = 512_000;
const HN_DAILY_FEED_CACHE_SECONDS = 900;
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
  const normalizedPromptTemplate = normalizePromptTemplate(
    payload.promptTemplate,
  );
  const cacheKey = await createSummaryCacheKey(
    payload.postId,
    normalizedPromptTemplate,
  );
  const cached = await readCachedSummary(env.SHARED_READ_STATE, cacheKey);

  if (cached) {
    return createCachedSummaryStream(cached, request.signal);
  }

  const canonicalPostResult = await readCanonicalPost(payload.postId);
  if (!canonicalPostResult.ok) {
    return createErrorStream(
      canonicalPostResult.error,
      canonicalPostResult.status,
    );
  }

  const canonicalPost = canonicalPostResult.value;
  const renderedPrompt = renderPromptTemplate(
    normalizedPromptTemplate,
    canonicalPost,
  );
  const prompt = buildOpenRouterPrompt(canonicalPost, renderedPrompt);

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
  const promptTemplate = readRequiredString(
    payload.promptTemplate,
    "promptTemplate",
  );

  if (!postId.ok) {
    return postId;
  }

  if (!promptTemplate.ok) {
    return promptTemplate;
  }

  if (!POST_ID_PATTERN.test(postId.value)) {
    return { ok: false, error: "postId is invalid." };
  }

  if (promptTemplate.value.length > MAX_PROMPT_TEMPLATE_LENGTH) {
    return { ok: false, error: "promptTemplate is too long." };
  }

  if (PROMPT_TEMPLATE_HARD_CODED_URL_PATTERN.test(promptTemplate.value)) {
    return {
      ok: false,
      error:
        "promptTemplate must use {originalUrl} and {hnCommentsUrl} instead of hard-coded URLs.",
    };
  }

  return {
    ok: true,
    value: {
      postId: postId.value,
      promptTemplate: promptTemplate.value,
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

function renderPromptTemplate(
  promptTemplate: string,
  payload: Record<"title" | "originalUrl" | "hnCommentsUrl", string>,
) {
  return promptTemplate
    .split("{title}")
    .join(payload.title)
    .split("{originalUrl}")
    .join(payload.originalUrl)
    .split("{hnCommentsUrl}")
    .join(payload.hnCommentsUrl);
}

function buildOpenRouterPrompt(
  canonicalPost: CanonicalPost,
  renderedPrompt: string,
) {
  return [
    `Title: ${canonicalPost.title}`,
    `Article URL: ${canonicalPost.originalUrl}`,
    `Hacker News comments URL: ${canonicalPost.hnCommentsUrl}`,
    "",
    "Use only the Article URL and Hacker News comments URL above as external web sources.",
    "Apply the user's prompt below after replacing supported placeholders.",
    "",
    "User prompt:",
    renderedPrompt,
  ].join("\n");
}

async function createSummaryCacheKey(
  postId: string,
  normalizedPromptTemplate: string,
) {
  const digest = await sha256Hex(
    JSON.stringify({
      model: MODEL,
      promptVersion: SUMMARY_PROMPT_VERSION,
      postId,
      promptTemplate: normalizedPromptTemplate,
    }),
  );

  return `summary:v1:${digest}`;
}

async function readCanonicalPost(
  postId: string,
): Promise<
  | { ok: true; value: CanonicalPost }
  | { ok: false; error: string; status: number }
> {
  const postIdParts = postId.match(/^(\d{4}-\d{2}-\d{2})-(\d+)$/);
  if (!postIdParts) {
    return { ok: false, error: "postId is invalid.", status: 400 };
  }

  const [, issueDate, rankText] = postIdParts;
  const rank = Number(rankText);

  try {
    const response = await fetch(HN_DAILY_FEED_URL, {
      headers: {
        Accept: "application/rss+xml,text/xml;q=0.9,*/*;q=0.8",
        "User-Agent":
          "hnnews-daily/1.0 (+https://github.com/fytriht/hnnews-daily)",
      },
      cf: {
        cacheTtl: HN_DAILY_FEED_CACHE_SECONDS,
        cacheEverything: true,
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        error: "Unable to load Hacker News Daily feed.",
        status: 502,
      };
    }

    const feed = await readResponseTextWithLimit(
      response,
      MAX_HN_DAILY_FEED_BYTES,
    );
    const descriptionHtml = readIssueDescription(feed, issueDate);
    if (!descriptionHtml) {
      return {
        ok: false,
        error: "Post was not found in Hacker News Daily.",
        status: 404,
      };
    }

    const postHtml = readPostHtmlAtRank(descriptionHtml, rank);
    const canonicalPost = postHtml
      ? parseCanonicalPostHtml(postHtml, postId)
      : null;

    if (!canonicalPost) {
      return {
        ok: false,
        error: "Post was not found in Hacker News Daily.",
        status: 404,
      };
    }

    return { ok: true, value: canonicalPost };
  } catch {
    return {
      ok: false,
      error: "Unable to load Hacker News Daily feed.",
      status: 502,
    };
  }
}

async function readResponseTextWithLimit(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("Response is too large.");
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      await reader.cancel();
      throw new Error("Response is too large.");
    }

    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function readIssueDescription(feed: string, issueDate: string) {
  for (const itemMatch of feed.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item = itemMatch[1];
    const title = readXmlTagText(item, "title");
    const link = readXmlTagText(item, "link");

    if (extractIssueDate(title, link) !== issueDate) {
      continue;
    }

    return readXmlTagRaw(item, "description");
  }

  return null;
}

function readXmlTagText(xml: string, tagName: string) {
  return decodeHtml(stripCdata(readXmlTagRaw(xml, tagName))).trim();
}

function readXmlTagRaw(xml: string, tagName: string) {
  const tagPattern = new RegExp(
    `<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
    "i",
  );
  const match = xml.match(tagPattern);

  return match ? match[1].trim() : "";
}

function stripCdata(value: string) {
  const match = value.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);

  return match ? match[1] : value;
}

function extractIssueDate(title: string, link: string) {
  return (
    title.match(/\d{4}-\d{2}-\d{2}/)?.[0] ??
    link.match(/\d{4}-\d{2}-\d{2}/)?.[0] ??
    ""
  );
}

function readPostHtmlAtRank(descriptionHtml: string, rank: number) {
  const posts = Array.from(
    descriptionHtml.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi),
  );

  return posts[rank - 1]?.[1] ?? null;
}

function parseCanonicalPostHtml(
  postHtml: string,
  postId: string,
): CanonicalPost | null {
  const storyLink = readClassLink(postHtml, "storylink");
  const commentsLink = readClassLink(postHtml, "postlink");

  if (!storyLink || !commentsLink) {
    return null;
  }

  const originalUrl = normalizePublicHttpUrl(storyLink.href);
  const hnCommentsUrl = normalizeHackerNewsCommentsUrl(commentsLink.href);
  const title = decodeHtml(stripTags(storyLink.text))
    .replace(/\s+/g, " ")
    .trim();

  if (!originalUrl || !hnCommentsUrl || !title) {
    return null;
  }

  return {
    postId,
    title,
    originalUrl,
    hnCommentsUrl,
  };
}

function readClassLink(html: string, className: string) {
  const linkPattern = new RegExp(
    `<span\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>[\\s\\S]*?<a\\b[^>]*href=(["'])(.*?)\\1[^>]*>([\\s\\S]*?)<\\/a>`,
    "i",
  );
  const match = html.match(linkPattern);

  return match
    ? {
        href: decodeHtml(match[2]).trim(),
        text: match[3],
      }
    : null;
}

function normalizePublicHttpUrl(value: string) {
  try {
    const url = new URL(value);

    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function normalizeHackerNewsCommentsUrl(value: string) {
  try {
    const url = new URL(value);

    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.hostname !== "news.ycombinator.com" ||
      url.pathname !== "/item" ||
      !url.searchParams.get("id")
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function normalizePromptTemplate(promptTemplate: string) {
  return promptTemplate
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(value: string) {
  return value.replace(/<[^>]*>/g, "");
}

function decodeHtml(value: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value
    .replace(/&#(\d+);/g, (_, codePoint: string) =>
      decodeCodePoint(Number(codePoint)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, codePoint: string) =>
      decodeCodePoint(Number.parseInt(codePoint, 16)),
    )
    .replace(
      /&([a-z]+);/gi,
      (match, name: string) => namedEntities[name.toLowerCase()] ?? match,
    );
}

function decodeCodePoint(codePoint: number) {
  if (!Number.isFinite(codePoint)) {
    return "";
  }

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return "";
  }
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

    await wait(CACHED_STREAM_INITIAL_DELAY_MS, signal);

    const chunks = chunkText(cached.summary);

    for (let index = 0; index < chunks.length; index += 1) {
      if (signal.aborted) {
        controller.close();
        return;
      }

      const chunk = chunks[index];
      enqueueEvent(controller, "delta", { text: chunk });

      if (index < chunks.length - 1) {
        await wait(readCachedStreamDelay(chunk), signal);
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
  prompt,
  signal,
}: {
  apiKey: string;
  cacheKey: string;
  kv: KVNamespace;
  origin: string;
  prompt: string;
  signal: AbortSignal;
}) {
  return createEventStream(async (controller) => {
    const generatedAt = new Date().toISOString();
    let response: Response;

    try {
      response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
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
                "You summarize Hacker News posts. Fetch and read the provided article URL and Hacker News comments URL before answering. Follow the user's prompt.",
            },
            {
              role: "user",
              content: prompt,
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
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        closeEventStream(controller);
        return;
      }

      throw error;
    }

    if (signal.aborted) {
      closeEventStream(controller);
      return;
    }

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

    try {
      while (!streamDone) {
        if (signal.aborted) {
          await reader.cancel();
          closeEventStream(controller);
          return;
        }

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
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        await reader.cancel().catch(() => undefined);
        closeEventStream(controller);
        return;
      }

      throw error;
    }

    if (signal.aborted) {
      closeEventStream(controller);
      return;
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

    if (signal.aborted) {
      closeEventStream(controller);
      return;
    }

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

          return typeof deltaContent === "string" ? deltaContent : "";
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
          if (isAbortError(error)) {
            closeEventStream(controller);
            return;
          }

          try {
            enqueueEvent(controller, "error", {
              message:
                error instanceof Error
                  ? error.message
                  : "Unable to summarize this post.",
            });
          } catch {
            closeEventStream(controller);
            return;
          }

          closeEventStream(controller);
        }
      },
    }),
    {
      status,
      headers: STREAM_HEADERS,
    },
  );
}

function closeEventStream(
  controller: ReadableStreamDefaultController<Uint8Array>,
) {
  try {
    controller.close();
  } catch {
    return;
  }
}

function isAbortError(error: unknown) {
  if (!error || typeof error !== "object" || !("name" in error)) {
    return false;
  }

  return (error as { name?: unknown }).name === "AbortError";
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

function wait(milliseconds: number, signal?: AbortSignal) {
  if (!signal) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }

  if (signal.aborted) {
    return Promise.reject(
      new DOMException("Summary generation stopped.", "AbortError"),
    );
  }

  return new Promise<void>((resolve, reject) => {
    function handleAbort() {
      clearTimeout(timeout);
      reject(new DOMException("Summary generation stopped.", "AbortError"));
    }

    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", handleAbort, { once: true });
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
