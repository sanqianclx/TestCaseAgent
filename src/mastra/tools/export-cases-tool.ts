import { createTool } from "@mastra/core/tools"
import path from "path"
import { z } from "zod"
import { callPythonScript } from "../runtime/python-bridge.js"

export interface ExportCasesOutput {
  exported_files: string[]
}

/**
 * 将测试用例和测试代码导出为文件
 * 生成两个文件：
 *   (1) test_generated.py —— 可被pytest直接执行的Python测试代码文件
 *   (2) test_cases.md —— 包含测试用例表格、执行摘要和诊断信息的Markdown文档
 * 在测试全部通过或诊断完成后调用此工具，输出即为最终交付物。
 *
 * @param inputData.test_cases - 测试用例列表
 * @param inputData.test_code - 完整的pytest测试代码
 * @param inputData.output_dir - 输出目录路径
 * @param inputData.execution_result - 可选的pytest执行结果，写入执行摘要
 * @param inputData.diagnosis - 可选的失败诊断结果，写入失败诊断章节
 * @returns 导出的文件路径列表
 */
export function exportCases(inputData: {
  test_cases: unknown[]
  test_code: string
  output_dir: string
  execution_result?: unknown
  diagnosis?: unknown
  quality?: unknown
  coverage?: unknown
  versions?: unknown[]
  artifact_prefix?: string
  skip_py?: boolean
}): ExportCasesOutput {
  const result = callPythonScript<ExportCasesOutput>("export_cases.py", {
    ...inputData,
    output_dir: path.resolve(inputData.output_dir),
  }, 30_000)
  if (!result.ok || !result.data) {
    throw new Error(`导出失败: ${result.error?.message ?? "未知错误"}`)
  }
  return result.data
}

/**
 * 判定路径是否在 CWD 之内（用于 export-cases 条件审批）
 * 对工作流零影响：纯本地路径比较，工作流不调用本函数
 */
function isPathInsideCwd(target: string): boolean {
  if (typeof target !== "string" || target.length === 0) return false
  const resolved = path.resolve(target)
  const cwd = process.cwd()
  const cmp = (s: string) => (process.platform === "win32" ? s.toLowerCase() : s)
  return cmp(resolved) === cmp(cwd) || cmp(resolved).startsWith(cmp(cwd) + path.sep)
}

export const exportCasesTool = createTool({
  id: "export-cases",
  // V2.4: 工具级 requireApproval（agent 级开关已关闭）
  // 用函数形式做条件审批：仅当 output_dir 在 CWD 外时才需要 y/n；
  // CWD 内（如 output/exports/...）自动放行
  // 对工作流零影响：requireApproval 只在 Agent 调用时由框架拦截；工作流不经过这层
  requireApproval: async (input: { output_dir?: string }) => {
    const dir = input?.output_dir
    if (typeof dir !== "string") return true
    return !isPathInsideCwd(dir)
  },
  description:
    "将生成完成的测试用例列表和pytest测试代码导出为文件：" +
    "(1) test_generated.py 可执行pytest测试文件，" +
    "(2) test_cases.md 测试用例文档（含表格、执行摘要和诊断信息）。" +
    "在测试执行完毕（无论通过或失败）且不需要进一步自愈或诊断后，调用此工具生成最终交付物。",
  inputSchema: z.object({
    test_cases: z.array(z.any()).describe("完整的测试用例列表，每条用例包含编号、标题、优先级、类型、前置条件、步骤、预期结果"),
    test_code: z.string().describe("完整的pytest测试代码内容"),
    output_dir: z.string().describe("输出目录的绝对或相对路径，目录不存在时会自动创建"),
    execution_result: z.any().optional().describe("pytest执行结果对象（status/passed/failed/errors/stdout/stderr/exit_code/duration_ms/timeout）"),
    diagnosis: z.any().optional().describe("失败诊断结果对象（diagnosis_type/confidence/evidence/next_action）"),
    quality: z.any().optional().describe("质量检查结果对象（ok/issues/checked_tests）"),
    versions: z.array(z.any()).optional().describe("测试代码版本记录，用于在报告中展示自愈过程"),
    artifact_prefix: z.string().optional().describe("可选导出文件后缀，如plan会生成test_cases_plan.md"),
    // V2.4 新增：LLM 自评风险（CLI 显示）。.optional() 对现有调用方完全向后兼容
    risk: z.object({
      level: z.enum(["low", "medium", "high"])
        .describe("你评估的导出操作风险等级；output_dir 在 CWD 外时建议给 high"),
      reasons: z.array(z.string())
        .describe("1-3 条具体风险原因"),
    }).optional(),
  }),
  outputSchema: z.object({
    exported_files: z.array(z.string()).describe("生成的文件绝对路径列表"),
  }),
  execute: async (inputData) => {
    return exportCases(inputData)
  },
})
