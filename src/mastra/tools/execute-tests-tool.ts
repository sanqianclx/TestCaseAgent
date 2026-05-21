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

/**
 * 在隔离的临时工作目录中执行pytest并返回结构化执行结果
 * 使用Python子进程以沙箱方式执行，默认超时60秒自动终止。
 * 测试代码和源代码均写入临时目录，测试完成后自动清理。
 * 返回值包含通过/失败/错误的用例数、标准输出、标准错误、退出码、耗时、是否超时。
 *
 * @param inputData.test_code - 待执行的pytest测试代码内容
 * @param inputData.source_code - 被测Python源代码内容（写入临时文件供测试导入）
 * @param inputData.filename - 被测源文件名（用于保持导入模块名一致）
 * @param inputData.timeout - 执行超时秒数，默认60
 * @returns pytest执行结果的完整统计信息
 */
export function executePytest(inputData: {
  test_code: string
  source_code: string
  filename?: string
  timeout?: number
}): ExecuteTestsOutput {
  const result = callPythonScript<ExecuteTestsOutput>(
    "run_pytest.py",
    inputData,
    (inputData.timeout ?? 60) * 1000 + 10_000
  )
  if (!result.ok || !result.data) {
    throw new Error(`测试执行失败: ${result.error?.message ?? "未知错误"}`)
  }
  return result.data
}

export const executeTestsTool = createTool({
  id: "execute-tests",
  description:
    "在隔离的临时工作目录中执行pytest运行生成的测试代码和被测源代码。" +
    "执行环境使用Python子进程隔离，自动捕获stdout、stderr、退出码和耗时。" +
    "默认超时60秒自动终止。在生成测试代码并写入文件之后、需要判断测试是否通过时调用此工具。" +
    "如果status为'passed'且failed为0且errors为0，表示测试全部通过。",
  inputSchema: z.object({
    test_code: z.string().describe("完整的pytest测试代码内容"),
    source_code: z.string().describe("被测Python源代码内容，将被写入临时文件以供测试模块import"),
    filename: z.string().optional().describe("被测源文件名（如user_service.py），用于保持导入时的模块名一致"),
    timeout: z.number().default(60).describe("pytest执行超时秒数，超时后自动终止进程"),
  }),
  outputSchema: z.object({
    status: z.string().describe("执行状态：passed（全部通过）/ failed（有失败）/ error（执行出错）/ timeout（超时）"),
    passed: z.number().describe("通过的测试用例数"),
    failed: z.number().describe("失败的测试用例数"),
    errors: z.number().describe("执行出错的测试用例数"),
    stdout: z.string().describe("pytest标准输出（含测试结果详情）"),
    stderr: z.string().describe("pytest标准错误输出（含异常堆栈）"),
    exit_code: z.number().describe("pytest进程退出码，0表示全部通过"),
    duration_ms: z.number().describe("执行耗时（毫秒）"),
    timeout: z.boolean().describe("是否因超时被终止"),
  }),
  execute: async (inputData) => {
    return executePytest(inputData)
  },
})
