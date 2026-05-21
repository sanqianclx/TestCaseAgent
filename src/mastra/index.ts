import { Mastra } from "@mastra/core"
import { generateTestWorkflow } from "./workflows/generate-test-workflow.js"
import { testCaseAgent } from "./agents/test-case-agent.js"
import { testCodeAgent } from "./agents/test-code-agent.js"
import { diagnosisAgent } from "./agents/diagnosis-agent.js"

/*
 * Mastra 入口文件
 * 注册所有 Agent 和 Workflow，供 Studio/CLI 调用
 */
export const mastra = new Mastra({
  agents: {
    testCaseAgent,
    testCodeAgent,
    diagnosisAgent,
  },
  workflows: {
    generateTestWorkflow,
  },
})
