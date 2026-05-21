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
  description: "读取指定路径的Python源文件或粘贴代码临时文件",
  inputSchema: z.object({
    path: z.string().describe("文件路径"),
    encoding: z.string().default("utf-8").describe("文件编码"),
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
