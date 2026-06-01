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
 * 读取指定路径的任意文件并返回完整内容与元信息
 * 支持所有文件类型（.py、.java、.cpp、.txt、.json等）。
 * 返回值包含文件内容、文件名、绝对路径和行数统计。
 * 对于二进制文件，读取结果可能包含乱码，建议仅用于文本文件。
 *
 * @param inputData.path - 文件路径（支持相对或绝对路径）
 * @param inputData.encoding - 文件编码，默认utf-8
 * @returns 文件内容、文件名、绝对路径、行数
 */
export async function readFile(inputData: ReadFileInput): Promise<ReadFileOutput> {
  const filePath = path.resolve(inputData.path)
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
    "读取指定路径的任意文件，返回文件内容、文件名和行数。" +
    "支持所有文件类型：Python（.py）、Java（.java）、C++（.cpp/.hpp）、" +
    "JSON、TXT、YAML 等文本格式均支持。" +
    "在解析源代码之前必须调用此工具获取文件内容。",
  inputSchema: z.object({
    path: z.string().describe("文件路径（相对或绝对路径均可），支持任意文件类型"),
    encoding: z.string().default("utf-8").describe("文件编码，默认utf-8"),
  }),
  outputSchema: z.object({
    content: z.string(),
    filename: z.string(),
    file_path: z.string(),
    line_count: z.number(),
  }),
  execute: async (inputData) => {
    return readFile({
      path: inputData.path,
      encoding: inputData.encoding as BufferEncoding,
    })
  },
})
