import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import fs from "fs/promises"
import path from "path"

export interface WriteFileInput {
  path: string
  content: string
  encoding?: BufferEncoding
}

export interface WriteFileOutput {
  filename: string
  file_path: string
  size: number
  encoding: string
}

/**
 * 将内容写入指定路径的文件
 * 自动创建不存在的父目录。
 * 如果文件已存在则覆盖写入。
 * 支持所有文本类型的内容写入。
 *
 * @param inputData.path - 文件路径（支持相对或绝对路径）
 * @param inputData.content - 要写入的文件内容
 * @param inputData.encoding - 文件编码，默认utf-8
 * @returns 文件名、绝对路径、写入字节数和编码
 */
export async function writeFile(inputData: WriteFileInput): Promise<WriteFileOutput> {
  const filePath = path.resolve(inputData.path)
  const encoding = inputData.encoding ?? "utf-8"

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, inputData.content, encoding)

  const stat = await fs.stat(filePath)

  return {
    filename: path.basename(filePath),
    file_path: filePath,
    size: stat.size,
    encoding,
  }
}

export const writeFileTool = createTool({
  id: "write-file",
  description:
    "将内容写入指定路径的文件，自动创建不存在的父目录。如果文件已存在则覆盖。支持所有文本类型内容。",
  inputSchema: z.object({
    path: z.string().describe("文件路径（相对或绝对路径均可），自动创建父目录"),
    content: z.string().describe("要写入的文件内容"),
    encoding: z.string().default("utf-8").describe("文件编码，默认utf-8"),
  }),
  outputSchema: z.object({
    filename: z.string(),
    file_path: z.string(),
    size: z.number(),
    encoding: z.string(),
  }),
  execute: async (inputData) => {
    return writeFile({
      path: inputData.path,
      content: inputData.content,
      encoding: inputData.encoding as BufferEncoding,
    })
  },
})
