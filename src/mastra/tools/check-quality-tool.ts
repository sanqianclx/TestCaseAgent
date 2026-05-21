import { createTool } from "@mastra/core/tools"
import { z } from "zod"

export interface QualityCheckResult {
  ok: boolean
  issues: string[]
}

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
  description: "检查pytest测试代码是否存在空断言、恒真断言、弱断言等质量问题",
  inputSchema: z.object({
    test_code: z.string().describe("pytest测试代码内容"),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    issues: z.array(z.string()),
  }),
  execute: async (inputData) => {
    return checkTestQuality(inputData)
  },
})
