import { Agent } from "@mastra/core/agent"
import "../runtime/env.js"
import { readFileTool } from "../tools/read-file-tool.js"

const instructions = `你是 Python、Java 和 C++ 单元测试失败诊断专家。

你的输出直接写入最终报告，所以请写自然语言的诊断文本，而不是 JSON。

关注根本原因：
- 如果源代码有错误，解释具体的源代码缺陷和正确的预期行为。
- 如果生成的测试代码有错误，解释测试代码错在哪里。
- 如果环境缺少工具或依赖，解释缺少什么，并仅以纯文本形式提及命令。
- 只引用关键的报错行。不要粘贴完整日志。
- 要直接而有用。`

export const diagnosisAgent = new Agent({
  id: "diagnosis-agent",
  name: "失败诊断 Agent",
  tools: { readFile: readFileTool },
  instructions,
  model: "deepseek/deepseek-v4-flash",
})

export const diagnosisAgentPro = new Agent({
  id: "diagnosis-agent-pro",
  name: "失败诊断 Agent Pro",
  tools: { readFile: readFileTool },
  instructions,
  model: "deepseek/deepseek-v4-pro",
})

export const diagnosisDecisionAgent = new Agent({
  id: "diagnosis-decision-agent",
  name: "失败诊断决策 Agent",
  tools: { readFile: readFileTool },
  instructions: `你将自然语言的单元测试失败诊断转换为用于自动化的简短 JSON 决策。
这个 JSON 是内部使用的，不会写入用户的最终报告。

只返回有效的 JSON：
{
  "diagnosis_type": "TEST_CODE_ERROR|SOURCE_RUNTIME_ERROR|BEHAVIOR_MISMATCH|ENVIRONMENT_ERROR|UNKNOWN",
  "confidence": 0.0,
  "summary": "简短决策摘要",
  "evidence": ["关键证据"],
  "next_action": "REGENERATE_TEST_CODE|ASK_USER_CONFIRMATION|INSTALL_DEPENDENCY|REPORT_TO_USER",
  "suggested_commands": ["可选的 shell 命令"]
}

决策规则：
- TEST_CODE_ERROR -> REGENERATE_TEST_CODE
- SOURCE_RUNTIME_ERROR -> REPORT_TO_USER
- BEHAVIOR_MISMATCH -> ASK_USER_CONFIRMATION
- ENVIRONMENT_ERROR -> INSTALL_DEPENDENCY
- UNKNOWN -> REPORT_TO_USER`,
  model: "deepseek/deepseek-v4-flash",
})
