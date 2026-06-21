const CODEX_WORKSPACE_PATH = "/Users/zhi/Developer/hnnews-daily";

export function buildCodexSummarizeUrl(originalUrl: string, hnCommentsUrl: string) {
  const prompt = `总结 ${originalUrl} ${hnCommentsUrl}`;
  const params = new URLSearchParams({
    prompt,
    path: CODEX_WORKSPACE_PATH,
  });

  return `codex://threads/new?${params.toString()}`;
}
