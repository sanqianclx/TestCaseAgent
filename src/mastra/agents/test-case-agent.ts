import { Agent } from "@mastra/core/agent"
import { parseSourceCodeTool } from "../tools/parse-source-code-tool.js"
import { readFileTool } from "../tools/read-file-tool.js"

/*
 * 测试用例生成Agent：负责理解代码逻辑、规划测试策略、生成测试用例描述
 */
export const testCaseAgent = new Agent({
  id: "test-case-agent",
  name: "测试用例生成Agent",
  instructions: `你是一个专业的测试用例设计专家。

你的职责：
1. 使用 readFile 工具读取用户上传的源代码
2. 使用 parseSourceCodeTool 解析代码结构（类、函数、参数、行号）
3. 根据解析结果，为每个函数/方法设计测试用例
4. 输出结构化的测试用例集，覆盖功能、边界、异常三种类型

生成策略：
- 功能测试：正常流程和分支路径
- 边界测试：等价类划分和边界值分析
- 异常测试：空值、超长输入、特殊字符、类型错误

输出格式要求：
- 每个用例包含：编号、标题、优先级(P0-P3)、类型、前置条件、步骤、预期结果
- 使用JSON数组格式输出，便于后续处理`,
  model: "openai/gpt-4o-mini",
  tools: {
    readFileTool,
    parseSourceCodeTool,
  },
})
