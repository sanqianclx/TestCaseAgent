import { Mastra } from "@mastra/core"
import { generateTestWorkflow } from "./workflows/generate-test-workflow.js"
import { testCaseAgent } from "./agents/test-case-agent.js"
import { testCodeAgent, testCodeAgentPro } from "./agents/test-code-agent.js"
import { diagnosisAgent, diagnosisAgentPro } from "./agents/diagnosis-agent.js"

/*
 * Mastra 入口文件
 * 注册所有 Agent 和 Workflow，供 Studio/CLI 调用
 * 快慢双通道设计：chat 用于首次快速生成，v4-pro 用于失败重试确保准确率
 */
export const mastra = new Mastra({
  agents: {
    testCaseAgent,
    testCodeAgent,
    testCodeAgentPro,
    diagnosisAgent,
    diagnosisAgentPro,
  },
  workflows: {
    generateTestWorkflow,
  },
})
