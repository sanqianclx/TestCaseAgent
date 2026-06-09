import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import { callPythonScript } from "../runtime/python-bridge.js"
import { cppAdapter } from "../languages/cpp-adapter.js"

export interface ExecuteTestsOutput {
  status: string // 执行状态：passed（全部通过）/ failed（有失败）/ error（执行出错）/ timeout（超时）
  passed: number // 通过的测试用例数
  failed: number // 失败的测试用例数
  errors: number // 执行出错的测试用例数
  stdout: string // pytest标准输出（含测试结果详情）
  stderr: string // pytest标准错误输出（含异常堆栈）
  exit_code: number // pytest进程退出码，0表示全部通过
  duration_ms: number // 执行耗时（毫秒）
  timeout: boolean // 是否因超时被终止
  test_results?: Array<{
    test_file: string // 测试文件路径
    test_class: string // 测试类名
    test_name: string // 测试方法名
    result: string // 测试结果：passed / failed / error
    failure_reason: string // 失败原因
  }>
  command?: string
  cwd?: string
  missing_dependencies?: string[]
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

export function executeGeneratedTests(inputData: {
  test_code: string
  source_code: string
  filename?: string
  source_file?: string
  language?: string
  timeout?: number
}): ExecuteTestsOutput {
  const language = (inputData.language ?? "python").toLowerCase()
  if (language === "python" || language === "py") {
    return executePytest(inputData)
  }

  if (language === "cpp" || language === "c++") {
    const filename = inputData.filename || inputData.source_file?.split(/[\\/]/).pop() || "source.cpp"
    const sourceFile = inputData.source_file || filename
    const analysis = cppAdapter.parseSource({
      sourceCode: inputData.source_code,
      filename,
      sourceFile,
    })
    return cppAdapter.executeTests({
      sourceCode: inputData.source_code,
      sourceFile,
      filename,
      testCode: inputData.test_code,
      outputDir: "",
      timeoutSeconds: inputData.timeout ?? 60,
      analysis,
    }) as ExecuteTestsOutput
  }

  return {
    status: "error",
    passed: 0,
    failed: 0,
    errors: 1,
    stdout: "",
    stderr: `execute-tests 暂不支持该语言: ${language}`,
    exit_code: -1,
    duration_ms: 0,
    timeout: false,
  }
}

export const executeTestsTool = createTool({
  id: "execute-tests",
  description:
    "在隔离的临时工作目录中执行生成的测试代码和被测源代码。" +
    "Python 使用 pytest，C++ 使用 GoogleTest + g++ 编译运行。" +
    "自动捕获stdout、stderr、退出码和耗时。" +
    "默认超时60秒自动终止。在生成测试代码并写入文件之后、需要判断测试是否通过时调用此工具。" +
    "如果status为'passed'且failed为0且errors为0，表示测试全部通过。",
  inputSchema: z.object({
    test_code: z.string().describe("完整的测试代码内容（pytest / GoogleTest）"),
    source_code: z.string().describe("被测源代码内容，将被写入临时文件以供测试导入或 include"),
    filename: z.string().optional().describe("被测源文件名（如 user_service.py / sample.cpp），用于保持导入或 include 名称一致"),
    source_file: z.string().optional().describe("被测源文件路径；C++ 可用于确定源文件 basename"),
    language: z.enum(["python", "py", "cpp", "c++"]).default("python").describe("语言标识"),
    timeout: z.number().default(60).describe("测试执行超时秒数，超时后自动终止进程"),
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
    command: z.string().optional().describe("实际执行命令"),
    cwd: z.string().optional().describe("临时执行目录"),
    test_results: z.array(z.any()).optional().describe("逐用例执行结果"),
    missing_dependencies: z.array(z.string()).optional().describe("缺失依赖列表"),
  }),
  execute: async (inputData) => {
    return executeGeneratedTests(inputData)
  },
})
