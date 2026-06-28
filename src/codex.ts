export const DEFAULT_CODEX_PROMPT_TEMPLATE =
  "总结 {originalUrl} {hnCommentsUrl}";

export interface CodexSettings {
  promptTemplate: string;
  projectPath: string;
}

export function buildCodexSummarizeUrl(
  originalUrl: string,
  hnCommentsUrl: string,
  settings: CodexSettings,
  title = "",
) {
  const promptTemplate = settings.promptTemplate.trim()
    ? settings.promptTemplate
    : DEFAULT_CODEX_PROMPT_TEMPLATE;
  const params = new URLSearchParams({
    prompt: renderPromptTemplate(
      promptTemplate,
      originalUrl,
      hnCommentsUrl,
      title,
    ),
  });
  const projectPath = settings.projectPath.trim();

  if (projectPath) {
    params.set("path", projectPath);
  }

  return `codex://threads/new?${params.toString()}`;
}

function renderPromptTemplate(
  template: string,
  originalUrl: string,
  hnCommentsUrl: string,
  title: string,
) {
  return template
    .split("{title}")
    .join(title)
    .split("{originalUrl}")
    .join(originalUrl)
    .split("{hnCommentsUrl}")
    .join(hnCommentsUrl);
}
