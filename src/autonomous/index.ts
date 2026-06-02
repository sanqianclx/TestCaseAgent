import { runAutonomousRepl } from "./autonomous-loop.js"
import { AUTONOMOUS_TOOL_NAMES } from "./autonomous-agent.js"

export { runAutonomousRepl, AUTONOMOUS_TOOL_NAMES }

/**
 * 自主 Agent 模式公共入口
 *
 * 与现有 generate-test-workflow 完全独立：
 * - 不引用任何工作流代码
 * - 不复用 workflow 的运行时（仅复用 `logger`、`cli-output`、`memoryStore`、各 tool 工厂）
 * - 通过 CLI 的 `--autonomous` / `--agent` flag 进入
 */
export const AUTONOMOUS_MODE_DESCRIPTION =
  "自主测试代码工程 Agent REPL。LLM 自主调用 9 个工具（读文件、解析、写测试、跑测试、跑覆盖率、导出、shell 兜底、ask-user），用户在关键步骤有 y/n 审批权。"

