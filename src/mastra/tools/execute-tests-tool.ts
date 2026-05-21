import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import { callPythonScript } from "../runtime/python-bridge.js"

export interface ExecuteTestsOutput {
  status: string
  passed: number
  failed: number
  errors: number
  stdout: string
  stderr: string
  exit_code: number
  duration_ms: number
  timeout: boolean
}

export function executePytest(inputData: {
  test_code: string
  source_code: string
  filename?: string
  timeout?: number
}): ExecuteTestsOutput {
  const result = callPythonScript<ExecuteTestsOutput>("run_pytest.py", inputData, (inputData.timeout ?? 60) * 1000 + 10_000)
  if (!result.ok || !result.data) {
    throw new Error(`测试执行失败: ${result.error?.message ?? "未知错误"}`)
  }
  return result.data
}

export const executeTestsTool = createTool({
  id: "execute-tests",
  description: "在临时目录中执行pytest，返回执行结果、stdout、stderr、退出码和耗时",
  inputSchema: z.object({
    test_code: z.string().describe("pytest测试代码内容"),
    source_code: z.string().describe("待测源代码内容"),
    filename: z.string().optional().describe("待测源文件名，用于保持导入模块名一致"),
    timeout: z.number().default(60).describe("超时秒数"),
  }),
  outputSchema: z.object({
    status: z.string(),
    passed: z.number(),
    failed: z.number(),
    errors: z.number(),
    stdout: z.string(),
    stderr: z.string(),
    exit_code: z.number(),
    duration_ms: z.number(),
    timeout: z.boolean(),
  }),
  execute: async (inputData) => {
    return executePytest(inputData)
  },
})
