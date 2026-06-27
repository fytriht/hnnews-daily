import {
  SHARE_ID_PATTERN,
  getMetaKey,
  getReadKey,
  getSummaryKey,
  jsonResponse,
  readSharedStatePayload,
  writeSharedState,
} from "./index";

interface Env {
  SHARED_READ_STATE: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  if (!env.SHARED_READ_STATE) {
    return jsonResponse({ error: "Shared state storage is not configured." }, 500);
  }

  const id = getShareId(params.id);
  if (!id) {
    return jsonResponse({ error: "Invalid share id." }, 400);
  }

  const meta = await env.SHARED_READ_STATE.get(getMetaKey(id));
  if (!meta) {
    return jsonResponse({ error: "Shared state was not found." }, 404);
  }

  const readPrefix = getReadKey(id, "");
  const summaryPrefix = getSummaryKey(id, "");
  const [readKeys, summaryKeys] = await Promise.all([
    listKeyNames(env.SHARED_READ_STATE, readPrefix),
    listKeyNames(env.SHARED_READ_STATE, summaryPrefix),
  ]);

  return jsonResponse({
    readState: Object.fromEntries(
      readKeys.map((key) => [key.slice(readPrefix.length), true]),
    ),
    summarizedPosts: Object.fromEntries(
      summaryKeys.map((key) => [key.slice(summaryPrefix.length), true]),
    ),
  });
};

export const onRequestPatch: PagesFunction<Env> = async ({
  env,
  params,
  request,
}) => {
  if (!env.SHARED_READ_STATE) {
    return jsonResponse({ error: "Shared state storage is not configured." }, 500);
  }

  const id = getShareId(params.id);
  if (!id) {
    return jsonResponse({ error: "Invalid share id." }, 400);
  }

  const meta = await env.SHARED_READ_STATE.get(getMetaKey(id));
  if (!meta) {
    return jsonResponse({ error: "Shared state was not found." }, 404);
  }

  const payloadResult = await readSharedStatePayload(request);
  if (!payloadResult.ok) {
    return jsonResponse({ error: payloadResult.error }, 400);
  }

  await writeSharedState(
    env.SHARED_READ_STATE,
    id,
    payloadResult.value,
    new Date().toISOString(),
  );

  return jsonResponse({ ok: true });
};

function getShareId(value: string | string[] | undefined) {
  const id = Array.isArray(value) ? value[0] : value;

  return id && SHARE_ID_PATTERN.test(id) ? id : null;
}

async function listKeyNames(kv: KVNamespace, prefix: string) {
  const names: string[] = [];
  let cursor: string | undefined;

  do {
    const page = await kv.list({ prefix, cursor });
    names.push(...page.keys.map((key) => key.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return names;
}
