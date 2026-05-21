import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import { callPythonScript } from "../runtime/python-bridge.js"

export interface ParsedSource {
  module_name: string
  imports: string[]
  classes: unknown[]
  functions: unknown[]
  warnings?: string[]
}

export function parseSourceCode(inputData: {
  source_code: string
  filename: string
}): ParsedSource {
  const result = callPythonScript<ParsedSource>("parse_source.py", inputData, 30_000)
  if (!result.ok || !result.data) {
    throw new Error(`代码解析失败: ${result.error?.message ?? "未知错误"}`)
  }
  return result.data
}

export const parseSourceCodeTool = createTool({
  id: "parse-source-code",
  description: "使用Python AST解析源代码，提取模块、类、函数、参数、行号等信息",
  inputSchema: z.object({
    source_code: z.string().describe("源代码内容"),
    filename: z.string().describe("源文件名"),
  }),
  outputSchema: z.object({
    module_name: z.string(),
    imports: z.array(z.string()),
    classes: z.array(z.any()),
    functions: z.array(z.any()),
    warnings: z.array(z.string()).optional(),
  }),
  execute: async (inputData) => {
    return parseSourceCode(inputData)
  },
})
