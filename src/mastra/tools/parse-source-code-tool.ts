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

/**
 * 使用Python AST解析源代码，提取模块名、导入列表、类定义、函数签名等结构化信息
 * 在生成测试用例之前必须调用此工具获取代码结构。
 * 返回值包含模块名、import列表、所有类（含方法）和函数的签名、行号、docstring等。
 * 若源文件存在语法错误则抛出PARSE_SYNTAX_ERROR。
 * 大文件（>500行或>20个符号）会在warnings中提示分批处理。
 *
 * @param inputData.source_code - 完整的Python源代码文本
 * @param inputData.filename - 源文件名（如"user_service.py"），模块名从文件名推断
 * @returns AST解析后的结构化信息
 */
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
  description:
    "使用Python AST静态解析Python源代码，提取所有可测试符号（模块名、导入列表、类定义及继承关系、方法签名、函数签名、参数类型注解、返回值类型、docstring、起始行号和结束行号）。" +
    "该工具在读取源代码之后、生成测试用例之前调用。LLM收到解析结果后应按每个函数/方法逐一设计测试用例。",
  inputSchema: z.object({
    source_code: z.string().describe("完整的Python源代码文本内容"),
    filename: z.string().describe("源文件名（如user_service.py），模块名从此推断"),
  }),
  outputSchema: z.object({
    module_name: z.string().describe("模块名（去掉.py后缀的文件名）"),
    imports: z.array(z.string()).describe("所有import语句列表"),
    classes: z.array(z.any()).describe("所有类定义，每个类包含name、bases、docstring、methods子数组"),
    functions: z.array(z.any()).describe("所有顶层函数定义，每个函数包含name、params、return_type、docstring、start_line、end_line"),
    warnings: z.array(z.string()).optional().describe("结构性警告（如文件过大或无测试符号）"),
  }),
  execute: async (inputData) => {
    return parseSourceCode(inputData)
  },
})
