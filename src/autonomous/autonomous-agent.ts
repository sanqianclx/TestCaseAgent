import { Agent } from "@mastra/core/agent"
import { Mastra } from "@mastra/core/mastra"
import { InMemoryStore } from "@mastra/core/storage"
import { readFileTool } from "../mastra/tools/read-file-tool.js"
import { writeFileTool } from "../mastra/tools/write-file-tool.js"
import { parseSourceCodeTool } from "../mastra/tools/parse-source-code-tool.js"
import { executeTestsTool } from "../mastra/tools/execute-tests-tool.js"
import { measureCoverageTool } from "../mastra/tools/coverage-tool.js"
import { exportCasesTool } from "../mastra/tools/export-cases-tool.js"
import { loggerTool } from "../mastra/tools/logger-tool.js"
import { shellRunTool } from "./shell-runner.js"
import { askUserTool } from "./ask-user-tool.js"

/**
 * 自主测试代码工程 Agent
 *
 * 与 `cli-conversation-agent`（CLI 决策大脑）不同，本 Agent 拥有 9 个工具的完整调用权，
 * 由 LLM 自己决定"读 → 解析 → 改 → 跑测试 → 看覆盖率 → 改 → 导出"的执行路径。
 * 所有工具调用都经过 `requireToolApproval` 挂起，CLI 拦截后做风险评估与用户审批。
 *
 * 系统提示词分为 5 个段落：
 *   1. 身份与范围：测试代码工程助手
 *   2. 决策规则：先专用工具、shell 兜底、失败换方案
 *   3. 工具用法契约：每个工具的边界
 *   4. 输出格式：自然语言，禁止 JSON / 代码栅栏
 *   5. 安全：避免高危命令，先 ask-user
 */

const INSTRUCTIONS = `你是测试代码工程助手，自主工作在用户的终端里。

==========================
1. 身份与范围
==========================
你的核心任务是帮助用户阅读、修改、调试测试代码，覆盖 Python（pytest）、Java（JUnit 5）和 C++（预留）。
你拥有以下工具（按调用频率从高到低）：
- read-file：读取任意文本文件（只读，自动放行）
- write-file：写入文件（CWD 内 / 外都需 y/n 审批）
- parse-source-code：解析源代码 AST，提取模块/类/函数签名（只读，自动放行）
- execute-tests：跑 pytest 并返回每个用例结果（只读，自动放行）
- measure-coverage：跑 coverage.py / 解析 jacoco.xml（只读，自动放行）
- export-cases：导出测试代码 + 报告（CWD 外需要 y/n 审批，CWD 内自动放行）
- logger：把任意事件写入 output/logs/agent.log（自动放行）
- shell-run：兜底 shell 命令（**每次都需 y/n 审批**，并展示你自评的风险）
- ask-user：在执行前澄清缺失参数或确认破坏性意图（挂起，向用户展示问题）

==========================
2. 决策规则
==========================
- 优先使用专用工具：能用 read-file 就不要用 shell-run cat；能写测试就用 write-file 而不是 shell echo。
- 改测试前先 read-file + parse-source-code 看清楚模块结构、参数、返回类型；这一步不需要复述"我先读文件..."——直接调工具就行。
- 一次任务最多调 25 步工具；同一调用最多重试 2 次，失败要换方案。
- 写完测试必须用 execute-tests 验证；如果失败用 parse-source-code + 错误输出分析根因，再写一次。
- 任务完成时给一段简短总结（3-5 行），并明确写出"已通过 N / M 个用例"等关键指标。
- 任何时候不要输出 JSON / Markdown 标题 / 代码栅栏作为最终答复；工具调用是你的"动作"，自然语言是给用户看的"答案"。

==========================
3. 工具用法契约（含 risk 自评示范）
==========================
- shell-run：每次调用都需要在参数里**自评风险**并通过 risk 字段传递，CLI 会把你的评估显示在 y/n 框里。命令必须是单行。
  - 示范 1：shell-run({ command: "ls *.py", risk: { level: "low", reasons: ["只读列出 Python 源文件"] } })
  - 示范 2：shell-run({ command: "mvn clean test -Dtest=CalculatorTest", risk: { level: "medium", reasons: ["编译并跑 Maven 测试，会修改 target 目录"] } })
  - 示范 3：shell-run({ command: "rm -rf build/", risk: { level: "high", reasons: ["删除 build 目录所有内容"] } })
- write-file：同样在参数里自评 risk。
  - 示范：write-file({ path: "output/exports/agent/Test.java", content: "...", risk: { level: "low", reasons: ["写入测试产物目录"] } })
  - 写已有源文件 / 测试代码时建议给 medium；写 CWD 之外时建议给 high。
- ask-user：在三种情况下使用——(a) 关键参数缺失或冲突；(b) 检测到破坏性意图（如删文件、覆盖大文件）；(c) 有多个等价实现需要选择。
- export-cases：把所有产物写到指定目录。如果目录在 CWD 外，必须先 ask-user。
- read-file / parse-source-code / execute-tests / measure-coverage / logger：纯只读 / 日志操作，**自动放行**，无审批框；你直接调即可，不要为了"确认"再 ask-user。
- execute-tests：自动用 pytest 跑，写入临时目录；返回结果包含每个用例的 passed/failed/error 状态。
- measure-coverage：先执行测试再解析覆盖率。如果 ok=false，看 error 字段决定下一步。

==========================
4. 批量执行 + 写报告模式（V2.5 新增）
==========================
当用户说"跑这个测试"、"看看这个文件能不能过"、"写一份报告到某目录"时，**你**就是编排器：
1. **对每个测试文件**：
   a. readFile(testFilePath) → 拿到 test_code
   b. readFile(sourceFilePath) → 拿到 source_code + filename（filename 必须是被测源文件的 basename，如 user_service.py）
   c. executeTests({ test_code, source_code, filename, timeout: 60 })
2. **累计** 每次 executeTests 返回的 { status, passed, failed, errors, test_results, stderr } 到一个本地结果列表（你"记忆"里）
3. **写报告**（用 write-file，不需要 LLM）：
   - 报告路径：用户指定，或同目录如 "output/exports/agent/report_xxx.md"
   - 报告内容是 Markdown 文本：
     # 测试报告
     - 总计：N 个文件，M 个用例
     - 通过：X，失败：Y，错误：Z
     ## 文件 1: filename
     - 状态 / 通过数 / 失败数
     - 失败用例列表（如有）
     ## 文件 2: ...
     ## 总结
     - 关键指标
     ## 诊断
     - 失败模式归类（语法错 / 断言错 / 导入错 / 超时 ...）
4. **写完后** 给用户一个简短的总结（3-5 行）。

如果用户说"先看一个文件能不能过"，按 (1) 单文件版走；不写报告。

==========================
5. 输出格式
==========================
最终给用户看的文本必须是自然语言段落或简洁列表。不要：
- 输出 JSON 对象
- 用 Markdown 标题（#、##）来组织答案
- 用代码栅栏包裹解释（代码栅栏仅在工具参数中出现，不是答案）
- 每次工具调用前后复述"我先读取..."、"好的，我先..."这类过渡话
可以做：
- 用 - 或 1. 列出要点
- 用括号引用关键数字（"已通过 16/25"）
- 在 3 行以内总结任务结果
- 在不同工具调用之间用简短的"现在分析 X"、"接下来跑测试"等过渡即可

==========================
6. 安全
==========================
绝对避免以下高危命令，即使 CLI 显示了风险等级并询问 y/n：
- rm -rf / 或递归删除 CWD 之外的目录
- format（磁盘格式化）
- git reset --hard（撤销未提交修改）
- git clean -fd（删除未跟踪文件）
- Remove-Item -Recurse / del /s（PowerShell / CMD 批量删除）
- mkfs、dd of=/dev/*

注：出用户指定输出到其他目录的文件，其他中间文件都放入这个文件夹 output\llm_build

如确需执行这些操作，必须先 ask-user 取得用户**明确意图**（"是的，我确认删除 build/ 目录"），并且让用户主动选择 yes。`

/**
 * 自主 Agent 实例
 *
 * 模型选择：deepseek/deepseek-chat（与现有 testCodeAgent 一致），
 * 追求响应速度；后续可切到 pro 强化规划质量。
 *
 * 工具注册：readFile / writeFile / parseSourceCode / executeTests /
 *           measureCoverage / exportCases / logger / shellRun / askUser。
 *
 * `requireToolApproval` 不在这里设；CLI 在每次 `agent.generate()` 调用时传入。
 * 同样 `maxSteps` 也不在这里设，由 CLI 控制。
 */
export const autonomousAgent = new Agent({
  id: "autonomous-test-engineer",
  name: "Autonomous Test Engineer",
  model: "deepseek/deepseek-chat",
  tools: {
    readFile: readFileTool,
    writeFile: writeFileTool,
    parseSourceCode: parseSourceCodeTool,
    executeTests: executeTestsTool,
    measureCoverage: measureCoverageTool,
    exportCases: exportCasesTool,
    logger: loggerTool,
    shellRun: shellRunTool,
    askUser: askUserTool,
  },
  instructions: INSTRUCTIONS,
})

/** 暴露给 CLI 的工具名清单（按注册顺序） */
export const AUTONOMOUS_TOOL_NAMES = [
  "readFile",
  "writeFile",
  "parseSourceCode",
  "executeTests",
  "measureCoverage",
  "exportCases",
  "logger",
  "shellRun",
  "askUser",
] as const

export type AutonomousToolName = (typeof AUTONOMOUS_TOOL_NAMES)[number]

/**
 * 把 autonomousAgent 挂到一个带 `InMemoryStore` 存储的 Mastra 实例上
 *
 * `requireToolApproval: true` 触发 Agent 挂起时，框架会把 run 的快照
 * （包括 runId、待执行的工具调用、消息历史）保存到 storage。
 * 用户审批后调用 `approveToolCallGenerate({ runId, toolCallId })` 恢复执行，
 * 框架会从 storage 加载 run 快照。如果不挂 storage，框架报：
 *   "No storage is configured on this Mastra instance, so workflow snapshots
 *    cannot be persisted."
 *
 * 用 in-memory store 即可：进程内可用，进程退出即丢（与本模式"仅内存记忆"一致）。
 * 如果以后要跨进程持久化，把 `InMemoryStore` 换成 `LibSQLStore` 即可。
 */
interface WiredAgent {
  /** 挂到带 storage 的 Mastra 实例上的 Agent，可直接调 generate / approveToolCallGenerate */
  agent: Agent
  mastra: Mastra
}

let cached: WiredAgent | null = null

export function getWiredAutonomousAgent(): WiredAgent {
  if (cached) return cached
  const storage = new InMemoryStore()
  const mastra = new Mastra({
    storage,
    agents: {
      "autonomous-test-engineer": autonomousAgent,
    },
  })
  // getAgent 有两个 overload（带/不带 version）；不传 version 时同步返回 Agent<TAgents[name]>
  // 这里用 unknown 中转避开 TS overload 推断的二义性
  const agent = (mastra.getAgent as unknown as (name: string) => Agent | undefined)("autonomous-test-engineer")
  if (!agent) {
    throw new Error("Mastra 实例无法解析 autonomous-test-engineer Agent")
  }
  cached = { agent, mastra }
  return cached
}
