import { createTool } from "@mastra/core/tools"
import { z } from "zod"

export interface QualityCheckResult {
  ok: boolean
  issues: string[]
  checked_tests: number
}

/**
 * 对生成的pytest测试代码进行静态质量检查
 * 使用轻量级静态扫描检测以下常见质量问题：
 *   1. NO_ASSERTION —— 测试代码中完全没有assert语句，属于无效测试
 *   2. TRIVIAL_ASSERTION —— 存在assert True或常量比较等恒真断言，永远不会失败
 *   3. NO_ASSERTION_IN_TEST —— 某个test函数没有断言或pytest.raises
 *   4. WEAK_ASSERTION —— 仅检查callable/hasattr/locals/is not None，未验证核心行为
 * 在execute_tests返回passed后调用，确保通过的测试不是靠"水断言"糊弄的。
 *
 * @param inputData.test_code - 待检查的pytest测试代码字符串
 * @returns 检查结果（ok=true表示无质量问题，issues列出具体问题）
 */
export function checkTestQuality(inputData: { test_code: string }): QualityCheckResult {
  const issues: string[] = []
  const code = inputData.test_code
  const tests = extractTestFunctions(code)

  if (tests.length === 0) {
    issues.push("NO_TEST_FUNCTION: 测试代码中没有发现 test_ 开头的测试函数")
  }

  if (!/\bassert\b/.test(code) && !/pytest\.raises|with\s+pytest\.raises/.test(code)) {
    issues.push("NO_ASSERTION: 测试代码中没有断言")
  }

  if (/\bassert\s+True\b/.test(code)) {
    issues.push("TRIVIAL_ASSERTION: 存在 assert True 恒真断言")
  }

  if (/\bassert\s+1\s*==\s*1\b/.test(code) || hasSameLiteralAssertion(code)) {
    issues.push("TRIVIAL_ASSERTION: 存在常量对常量的恒真断言")
  }

  for (const test of tests) {
    const assertionLines = test.body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("assert ") || line.includes("pytest.raises"))

    if (assertionLines.length === 0) {
      issues.push(`NO_ASSERTION_IN_TEST: ${test.name} 没有断言或 pytest.raises`)
      continue
    }

    const meaningfulAssertions = assertionLines.filter((line) => !isWeakAssertion(line))
    if (meaningfulAssertions.length === 0) {
      issues.push(`WEAK_ASSERTION: ${test.name} 只有弱断言，未验证核心行为`)
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    checked_tests: tests.length,
  }
}

function extractTestFunctions(code: string): Array<{ name: string; body: string }> {
  const lines = code.split(/\r?\n/)
  const tests: Array<{ name: string; body: string }> = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = line.match(/^(\s*)def\s+(test_[A-Za-z0-9_]+)\s*\(/)
    if (!match) continue

    const indent = match[1].length
    const body: string[] = []
    let cursor = index + 1
    while (cursor < lines.length) {
      const current = lines[cursor]
      const trimmed = current.trim()
      const currentIndent = current.match(/^(\s*)/)?.[1].length ?? 0

      if (
        trimmed &&
        currentIndent <= indent &&
        /^(def|class)\s+/.test(trimmed)
      ) {
        break
      }

      body.push(current)
      cursor += 1
    }

    tests.push({ name: match[2], body: body.join("\n") })
  }

  return tests
}

function hasSameLiteralAssertion(code: string): boolean {
  const literalPattern = /\bassert\s+(['"])([^'"]*)\1\s*==\s*(['"])([^'"]*)\3/g
  for (const match of code.matchAll(literalPattern)) {
    if (match[2] === match[4]) return true
  }
  return false
}

function isWeakAssertion(line: string): boolean {
  return (
    /\bassert\s+callable\(/.test(line) ||
    /\bassert\s+hasattr\(/.test(line) ||
    /\bassert\s+['"]result['"]\s+in\s+locals\(\)/.test(line) ||
    /\bassert\s+\w+\s+is\s+not\s+None\b/.test(line) ||
    /\bassert\s+isinstance\(\s*\w+\s*,/.test(line)
  )
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
    checked_tests: z.number().describe("实际检查到的pytest测试函数数量"),
  }),
  execute: async (inputData) => {
    return checkTestQuality(inputData)
  },
})
