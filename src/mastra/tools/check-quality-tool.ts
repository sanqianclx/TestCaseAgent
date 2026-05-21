import { createTool } from "@mastra/core/tools"
import { z } from "zod"

export interface QualityCheckResult {
  ok: boolean
  issues: string[]
}

/**
 * 对生成的pytest测试代码进行静态质量检查
 * 使用正则表达式检测以下4类常见质量问题：
 *   1. NO_ASSERTION —— 测试代码中完全没有assert语句，属于无效测试
 *   2. TRIVIAL_ASSERTION —— 存在assert True或常量比较等恒真断言，永远不会失败
 *   3. TRIVIAL_ASSERTION —— 对常量对常量的比较（如assert "a"=="a"），毫无意义
 *   4. WEAK_ASSERTION —— 仅检查is not None而未验证函数核心行为
 * 在execute_tests返回passed后调用，确保通过的测试不是靠"水断言"糊弄的。
 *
 * @param inputData.test_code - 待检查的pytest测试代码字符串
 * @returns 检查结果（ok=true表示无质量问题，issues列出具体问题）
 */
export function checkTestQuality(inputData: { test_code: string }): QualityCheckResult {
  const issues: string[] = []
  const code = inputData.test_code

  if (!/\bassert\b/.test(code)) {
    issues.push("NO_ASSERTION: 测试代码中没有断言")
  }

  if (/\bassert\s+True\b/.test(code)) {
    issues.push("TRIVIAL_ASSERTION: 存在 assert True 恒真断言")
  }

  if (/\bassert\s+1\s*==\s*1\b/.test(code) || /\bassert\s+['"][^'"]*['"]\s*==\s*['"][^'"]*['"]/.test(code)) {
    issues.push("TRIVIAL_ASSERTION: 存在常量对常量的恒真断言")
  }

  if (/def\s+test_/.test(code) && !/\bassert\s+callable\(/.test(code) && /\bassert\s+\w+\s+is\s+not\s+None\b/.test(code)) {
    issues.push("WEAK_ASSERTION: 仅检查非空，未验证核心行为")
  }

  return {
    ok: issues.length === 0,
    issues,
  }
}

export const checkQualityTool = createTool({
  id: "check-quality",
  description:
    "对已生成并通过执行的pytest测试代码进行静态质量审查，检测4类常见水货断言：" +
    "（1）完全没有assert的假测试；" +
    "（2）assert True等恒真断言；" +
    "（3）对常量与常量的无意义比较；" +
    "（4）仅检查is not None但不验证函数实际行为的弱断言。" +
    "在execute_tests返回passed之后、导出结果之前调用此工具。只有ok=true时才认为测试真正通过。",
  inputSchema: z.object({
    test_code: z.string().describe("已生成但尚未导出的pytest测试代码内容"),
  }),
  outputSchema: z.object({
    ok: z.boolean().describe("是否通过质量检查，true表示无任何水货断言"),
    issues: z.array(z.string()).describe("质量问题列表，每项以问题代码开头，后跟中文说明"),
  }),
  execute: async (inputData) => {
    return checkTestQuality(inputData)
  },
})
