interface Env {
  SHARED_READ_STATE: KVNamespace;
}

interface SharedStatePayload {
  readState?: Record<string, boolean>;
  summarizedPosts?: Record<string, boolean>;
}

const SHARE_ID_LENGTH = 10;
const SHARE_ID_PATTERN = /^[A-Za-z0-9]{10}$/;
const ISSUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const POST_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-\d+$/;
const SHARE_ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const META_VERSION = 1;

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  if (!env.SHARED_READ_STATE) {
    return jsonResponse({ error: "Shared state storage is not configured." }, 500);
  }

  const payloadResult = await readSharedStatePayload(request);
  if (!payloadResult.ok) {
    return jsonResponse({ error: payloadResult.error }, 400);
  }

  const id = await createUniqueShareId(env.SHARED_READ_STATE);
  const now = new Date().toISOString();

  await writeSharedState(env.SHARED_READ_STATE, id, payloadResult.value, now, now);

  return jsonResponse({ id }, 201);
};

async function createUniqueShareId(kv: KVNamespace): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = createShareId();
    const existing = await kv.get(getMetaKey(id));

    if (!existing) {
      return id;
    }
  }

  throw new Error("Unable to create a unique share id.");
}

function createShareId(): string {
  const bytes = new Uint8Array(SHARE_ID_LENGTH);
  crypto.getRandomValues(bytes);

  return Array.from(bytes, (byte) => {
    return SHARE_ID_ALPHABET[byte % SHARE_ID_ALPHABET.length];
  }).join("");
}

async function readSharedStatePayload(
  request: Request,
): Promise<
  | { ok: true; value: SharedStatePayload }
  | { ok: false; error: string }
> {
  let parsed: unknown;

  try {
    parsed = await request.json();
  } catch {
    return { ok: false, error: "Request body must be valid JSON." };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const payload = parsed as SharedStatePayload;
  const readStateResult = validateBooleanMap(
    payload.readState,
    ISSUE_DATE_PATTERN,
    "readState",
  );
  if (!readStateResult.ok) {
    return readStateResult;
  }

  const summarizedPostsResult = validateBooleanMap(
    payload.summarizedPosts,
    POST_ID_PATTERN,
    "summarizedPosts",
  );
  if (!summarizedPostsResult.ok) {
    return summarizedPostsResult;
  }

  return {
    ok: true,
    value: {
      readState: readStateResult.value,
      summarizedPosts: summarizedPostsResult.value,
    },
  };
}

function validateBooleanMap(
  value: unknown,
  keyPattern: RegExp,
  fieldName: string,
):
  | { ok: true; value: Record<string, boolean> }
  | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, value: {} };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: `${fieldName} must be an object.` };
  }

  const entries = Object.entries(value);
  const invalidEntry = entries.find(
    ([key, entryValue]) =>
      !keyPattern.test(key) || typeof entryValue !== "boolean",
  );

  if (invalidEntry) {
    return {
      ok: false,
      error: `${fieldName} contains an invalid key or value.`,
    };
  }

  return {
    ok: true,
    value: Object.fromEntries(entries),
  };
}

async function writeSharedState(
  kv: KVNamespace,
  id: string,
  payload: SharedStatePayload,
  updatedAt: string,
  createdAt?: string,
) {
  const writes: Promise<unknown>[] = [
    kv.put(
      getMetaKey(id),
      JSON.stringify({
        version: META_VERSION,
        ...(createdAt ? { createdAt } : {}),
        updatedAt,
      }),
    ),
  ];

  for (const [date, isRead] of Object.entries(payload.readState ?? {})) {
    writes.push(
      isRead
        ? kv.put(getReadKey(id, date), "1")
        : kv.delete(getReadKey(id, date)),
    );
  }

  for (const [postId, isSummarized] of Object.entries(
    payload.summarizedPosts ?? {},
  )) {
    writes.push(
      isSummarized
        ? kv.put(getSummaryKey(id, postId), "1")
        : kv.delete(getSummaryKey(id, postId)),
    );
  }

  await Promise.all(writes);
}

function getMetaKey(id: string) {
  return `share:v1:${id}:meta`;
}

function getReadKey(id: string, date: string) {
  return `share:v1:${id}:read:${date}`;
}

function getSummaryKey(id: string, postId: string) {
  return `share:v1:${id}:summary:${postId}`;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export {
  ISSUE_DATE_PATTERN,
  POST_ID_PATTERN,
  SHARE_ID_PATTERN,
  getMetaKey,
  getReadKey,
  getSummaryKey,
  jsonResponse,
  readSharedStatePayload,
  writeSharedState,
};
