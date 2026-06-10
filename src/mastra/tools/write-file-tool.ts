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
  // V2.4: 工具级 requireApproval（agent 级开关已关闭）
  // 让 CLI 在执行前弹 y/n 审批框，自动放行只读工具
  // 对工作流零影响：requireApproval 只在 Agent 调用时由框架拦截；工作流不经过这层
  requireApproval: true,
  description:
    "将内容写入指定路径的文件，自动创建不存在的父目录。如果文件已存在则覆盖。支持所有文本类型内容。" +
    "【风险自评】调用前请评估此次写入的风险等级，并通过 risk 字段传递：\n" +
    "  - low：写入临时/构建产物（如 output/exports/ 下的文件）\n" +
    "  - medium：覆盖已有源文件 / 测试代码\n" +
    "  - high：覆盖系统文件 / 大文件 / CWD 之外的路径",
  inputSchema: z.object({
    path: z.string().describe("文件路径（相对或绝对路径均可），自动创建父目录"),
    content: z.string().describe("要写入的文件内容"),
    encoding: z.string().default("utf-8").describe("文件编码，默认utf-8"),
    // V2.4 新增：LLM 调用前自评的风险（.optional() 对现有调用方完全向后兼容）
    risk: z.object({
      level: z.enum(["low", "medium", "high"])
        .describe("你评估的写入操作风险等级"),
      reasons: z.array(z.string())
        .describe("1-3 条具体风险原因，例如'覆盖现有源文件'"),
    }).optional(),
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
