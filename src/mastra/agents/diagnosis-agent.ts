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
