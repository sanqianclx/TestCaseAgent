import path from "path"
import { cppAdapter } from "./cpp-adapter.js"
import { javaAdapter } from "./java-adapter.js"
import { pythonAdapter } from "./python-adapter.js"
import type { LanguageAdapter, SupportedLanguage } from "./types.js"

const adapters: Record<SupportedLanguage, LanguageAdapter> = {
  python: pythonAdapter,
  java: javaAdapter,
  cpp: cppAdapter,
}

const extensionMap = new Map<string, SupportedLanguage>()
for (const adapter of Object.values(adapters)) {
  for (const ext of adapter.extensions) {
    extensionMap.set(ext, adapter.language)
  }
}

export function getLanguageAdapter(language: SupportedLanguage): LanguageAdapter {
  return adapters[language]
}

export function detectLanguage(filePath: string, explicit?: string): SupportedLanguage {
  if (explicit && explicit !== "auto") {
    const normalized = explicit.toLowerCase()
    if (normalized === "python" || normalized === "py") return "python"
    if (normalized === "java") return "java"
    if (normalized === "cpp" || normalized === "c++" || normalized === "cc") return "cpp"
    throw new Error(`LANGUAGE_UNSUPPORTED: ${explicit}`)
  }

  const ext = path.extname(filePath).toLowerCase()
  const language = extensionMap.get(ext)
  if (!language) {
    throw new Error(`LANGUAGE_UNSUPPORTED: cannot detect language from ${ext || "unknown extension"}`)
  }
  return language
}

export type { LanguageAdapter, SupportedLanguage }
