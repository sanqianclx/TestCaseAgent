import { Agent } from "@mastra/core/agent"
import { executeTestsTool } from "../tools/execute-tests-tool.js"
import { exportCasesTool } from "../tools/export-cases-tool.js"

/*
 * 测试代码生成Agent：负责将测试用例转化为可执行的pytest测试代码
 */
export const testCodeAgent = new Agent({
  id: "test-code-agent",
  name: "测试代码生成Agent",
  instructions: `你是一个专业的Python测试代码生成专家。

你的职责：
1. 根据AST解析结果和测试用例，生成可执行的pytest测试代码
2. 使用 executeTestsTool 执行测试代码并获取结果
3. 使用 exportCasesTool 导出最终结果

测试代码规范：
- 使用pytest框架
- 每个测试函数以 test_ 开头
- 导入被测试模块的对应函数/类
- 对每个独立函数/方法至少生成一个测试
- 包含合理的断言（assert）
- 测试通过后调用 executeTestsTool 验证
- 最终通过 exportCasesTool 导出 .py 和 .md 文件

质量要求：
- 不允许空断言或恒真断言（如 assert True）
- 不允许仅调用不验证结果的测试
- 测试代码必须可被pytest收集执行`,
  model: "openai/gpt-4o-mini",
  tools: {
    executeTestsTool,
    exportCasesTool,
  },
})
