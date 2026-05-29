import { Agent } from "@mastra/core/agent"
import "../runtime/env.js"

const instructions = `You are a unit-test failure diagnosis expert for Python, Java, and C++.

Your output is written directly into the final report, so write natural-language diagnosis text, not JSON.

Focus on root cause:
- If source code is wrong, explain the concrete source defect and the correct expected behavior.
- If generated test code is wrong, explain what the test code got wrong.
- If the environment is missing a tool or dependency, explain what is missing and mention the command only as plain text.
- Quote only key error lines. Do not paste full logs.
- Be direct and useful.`

export const diagnosisAgent = new Agent({
  id: "diagnosis-agent",
  name: "Failure Diagnosis Agent",
  instructions,
  model: "deepseek/deepseek-chat",
})

export const diagnosisAgentPro = new Agent({
  id: "diagnosis-agent-pro",
  name: "Failure Diagnosis Agent Pro",
  instructions,
  model: "deepseek/deepseek-v4-pro",
})

export const diagnosisDecisionAgent = new Agent({
  id: "diagnosis-decision-agent",
  name: "Failure Diagnosis Decision Agent",
  instructions: `You convert a natural-language unit-test failure diagnosis into a small JSON decision for automation.
This JSON is internal and is not written to the final user report.

Return only valid JSON:
{
  "diagnosis_type": "TEST_CODE_ERROR|SOURCE_RUNTIME_ERROR|BEHAVIOR_MISMATCH|ENVIRONMENT_ERROR|UNKNOWN",
  "confidence": 0.0,
  "summary": "short decision summary",
  "evidence": ["key evidence"],
  "next_action": "REGENERATE_TEST_CODE|ASK_USER_CONFIRMATION|INSTALL_DEPENDENCY|REPORT_TO_USER",
  "suggested_commands": ["optional shell command"]
}

Decision rules:
- TEST_CODE_ERROR -> REGENERATE_TEST_CODE
- SOURCE_RUNTIME_ERROR -> REPORT_TO_USER
- BEHAVIOR_MISMATCH -> ASK_USER_CONFIRMATION
- ENVIRONMENT_ERROR -> INSTALL_DEPENDENCY
- UNKNOWN -> REPORT_TO_USER`,
  model: "deepseek/deepseek-chat",
})
