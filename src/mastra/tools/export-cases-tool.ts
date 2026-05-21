import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import { callPythonScript } from "../runtime/python-bridge.js"

export interface ExportCasesOutput {
  exported_files: string[]
}

export function exportCases(inputData: {
  test_cases: unknown[]
  test_code: string
  output_dir: string
  execution_result?: unknown
  diagnosis?: unknown
}): ExportCasesOutput {
  const result = callPythonScript<ExportCasesOutput>("export_cases.py", inputData, 30_000)
  if (!result.ok || !result.data) {
    throw new Error(`导出失败: ${result.error?.message ?? "未知错误"}`)
  }
  return result.data
}

export const exportCasesTool = createTool({
  id: "export-cases",
  description: "导出测试用例和测试代码为.md和.py文件",
  inputSchema: z.object({
    test_cases: z.array(z.any()).describe("测试用例列表"),
    test_code: z.string().describe("测试代码内容"),
    output_dir: z.string().describe("输出目录"),
    execution_result: z.any().optional().describe("测试执行结果"),
    diagnosis: z.any().optional().describe("失败诊断结果"),
  }),
  outputSchema: z.object({
    exported_files: z.array(z.string()),
  }),
  execute: async (inputData) => {
    return exportCases(inputData)
  },
})
