import path from "path"
import { memoryStore } from "./in-memory-store.js"

export interface TestAgentSessionState {
  sessionId: string
  lastSourceFile?: string
  lastOutputDir?: string
  lastLanguage?: string
  lastRequirements?: string
  lastLlmRetries?: number
  lastRunSummary?: {
    passed?: boolean
    exportedFiles?: string[]
    message?: string
  }
}

export function getSessionState(sessionId: string): TestAgentSessionState {
  const existing = memoryStore.getFact<TestAgentSessionState>(sessionId, "sessionState")
  if (existing) {
    return existing
  }
  const state: TestAgentSessionState = { sessionId }
  memoryStore.setFact(sessionId, "sessionState", state)
  return state
}

export function updateSessionState(
  sessionId: string,
  patch: Partial<Omit<TestAgentSessionState, "sessionId">>
): TestAgentSessionState {
  const state = {
    ...getSessionState(sessionId),
    ...patch,
    sessionId,
  }

  if (state.lastSourceFile) {
    state.lastSourceFile = path.resolve(state.lastSourceFile)
  }
  if (state.lastOutputDir) {
    state.lastOutputDir = path.resolve(state.lastOutputDir)
  }

  memoryStore.setFact(sessionId, "sessionState", state)
  return state
}
