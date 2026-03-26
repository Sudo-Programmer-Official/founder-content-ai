import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");

export async function loadPromptFile(promptPath: string): Promise<string> {
  return readFile(path.resolve(repoRoot, promptPath), "utf8");
}
