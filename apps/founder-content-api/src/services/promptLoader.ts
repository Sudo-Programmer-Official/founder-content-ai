import { access, readFile } from "node:fs/promises";
import path from "node:path";

export const promptFiles = {
  ideas: "packages/prompts/founder-content/idea-generator.prompt",
  hook: "packages/prompts/founder-content/hook-generator.prompt",
  post: "packages/prompts/founder-content/linkedin-post.prompt",
} as const;

export type PromptKey = keyof typeof promptFiles;

async function resolvePromptPath(key: PromptKey): Promise<string> {
  const promptPath = promptFiles[key];
  const candidatePaths = [
    path.resolve(process.cwd(), promptPath),
    path.resolve(process.cwd(), "..", promptPath),
    path.resolve(process.cwd(), "..", "..", promptPath),
    path.resolve(process.cwd(), "..", "..", "..", promptPath),
  ];

  for (const candidatePath of candidatePaths) {
    try {
      await access(candidatePath);
      return candidatePath;
    } catch {
      continue;
    }
  }

  throw new Error(`Prompt file could not be resolved for key "${key}".`);
}

export async function loadPrompt(key: PromptKey): Promise<string> {
  const resolvedPath = await resolvePromptPath(key);
  return readFile(resolvedPath, "utf8");
}
