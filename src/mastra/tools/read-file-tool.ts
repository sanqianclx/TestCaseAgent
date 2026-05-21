import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import fs from "fs/promises"
import path from "path"

export interface ReadFileInput {
  path: string
  encoding?: BufferEncoding
}

export interface ReadFileOutput {
  content: string
  filename: string
  file_path: string
  line_count: number
}

/**
 * 读取指定的Python源文件并返回完整内容与元信息
 * 仅支持读取.py文件，非Python文件会抛出FILE_TYPE_UNSUPPORTED错误。
 * 返回值包含文件内容、文件名、绝对路径和行数统计。
 *
 * @param inputData.path - 源文件路径（支持相对或绝对路径）
 * @param inputData.encoding - 文件编码，默认utf-8
 * @returns 文件内容、文件名、绝对路径、行数
 */
export async function readPythonFile(inputData: ReadFileInput): Promise<ReadFileOutput> {
  const filePath = path.resolve(inputData.path)

  if (path.extname(filePath) !== ".py") {
    throw new Error("FILE_TYPE_UNSUPPORTED: 仅支持读取 .py 源文件")
  }

  const content = await fs.readFile(filePath, inputData.encoding ?? "utf-8")

  return {
    content,
    filename: path.basename(filePath),
    file_path: filePath,
    line_count: content.split(/\r?\n/).length,
  }
}

export const readFileTool = createTool({
  id: "read-file",
  description:
    "读取指定路径的Python源文件（.py），返回源代码内容、文件名和行数。" +
    "在解析源代码之前必须调用此工具获取文件内容。" +
    "仅支持读取.py文件，不支持其他格式。",
  inputSchema: z.object({
    path: z.string().describe("Python源文件路径（相对或绝对路径均可）"),
    encoding: z.string().default("utf-8").describe("文件编码，默认utf-8"),
  }),
  outputSchema: z.object({
    content: z.string(),
    filename: z.string(),
    file_path: z.string(),
    line_count: z.number(),
  }),
  execute: async (inputData) => {
    return readPythonFile({
      path: inputData.path,
      encoding: inputData.encoding as BufferEncoding,
    })
  },
})
