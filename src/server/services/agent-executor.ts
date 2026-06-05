/**
 * Agent 执行器
 *
 * 接入现有的自主 Agent（src/autonomous/），
 * 让它使用用户的 API Key 调用 LLM 并操作文件。
 */

import { logger } from '../../mastra/runtime/logger.js';
import { getWiredAutonomousAgent } from '../../autonomous/autonomous-agent.js';
import { memoryStore } from '../../mastra/memory/in-memory-store.js';

/**
 * 单次工具调用
 */
export interface ToolCallRecord {
  toolName: string;
  args: any;
  result: any;
}

/**
 * 执行结果
 */
export interface AgentExecutionResult {
  success: boolean;
  testCode?: string;
  testFile?: string;
  testFilePath?: string;
  coverage?: Record<string, number>;
  execution?: {
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
  executionTime: number;
  error?: string;
  logs: string[];
  fullText?: string;
  /** 所有工具调用记录 */
  toolCalls?: ToolCallRecord[];
}

/**
 * 执行选项
 */
export interface ExecuteOptions {
  maxSteps?: number;
  timeout?: number;
  apiKey?: string;
  workspaceId?: number;
  onLog?: (message: string) => void;
}

/**
 * 设置环境变量中的 API Key
 */
function setupApiKey(apiKey: string): void {
  process.env.DEEPSEEK_API_KEY = apiKey;
}

/**
 * 非交互式 Agent 执行器
 *
 * 直接调用现有的自主 Agent，使用它的 9 个工具：
 * - read-file, write-file, parse-source-code
 * - execute-tests, measure-coverage
 * - logger, shell-run, ask-user, export-cases
 */
export async function executeAgentNonInteractive(
  input: string,
  language: string = 'python',
  options: ExecuteOptions = {}
): Promise<AgentExecutionResult> {
  const {
    maxSteps = 25,
    timeout = 300000,
    apiKey,
    onLog,
  } = options;

  const startTime = Date.now();
  const logs: string[] = [];

  const addLog = (message: string) => {
    logs.push(`[${new Date().toISOString()}] ${message}`);
    onLog?.(message);
    logger.info('agent-executor', { message });
  };

  try {
    if (!apiKey) {
      throw new Error('未提供 API Key');
    }

    // 设置 API Key
    setupApiKey(apiKey);
    addLog('已设置用户 API Key');

    // 获取 Agent 实例
    addLog('初始化自主 Agent...');
    const { agent } = getWiredAutonomousAgent();

    // 创建会话
    const sessionId = `api-agent-${Date.now()}`;
    memoryStore.getOrCreate(sessionId);
    memoryStore.addMessage(sessionId, 'system', 'API Agent session started');

    addLog('Agent 开始执行...');

    // 构建消息
    const messages = [
      {
        role: 'user',
        content: input,
      },
    ];

    // 调用 Agent
    // ask-user 检测策略：在 LLM 文本里匹配 <<ASK_USER:问题>> 标记
    const stream = await (agent as any).stream(messages, {
      maxSteps,
      modelSettings: { temperature: 0, maxOutputTokens: 4096 },
    });

    let fullText = '';
    let testCode = '';
    let testFile = '';
    // 收集所有工具调用与结果（按时间顺序）
    const toolCalls: Array<{ toolName: string; args: any; result: any }> = [];
    // write-file 写入的文件路径（多个取最后一个）
    let writtenFilePath: string | null = null;
    // write-file 写入的内容（多个取最后一个）
    let writtenFileContent: string | null = null;

    addLog('Agent 流式输出中...');

    // 处理流式输出
    for await (const chunk of stream.fullStream) {
      const type = (chunk as any).type;
      const payload = (chunk as any).payload;

      if (type === 'text-delta' && payload?.text) {
        fullText += payload.text;
      } else if (type === 'tool-call') {
        // 工具调用开始
        const toolName = payload?.toolName || 'unknown';
        const args = payload?.args || payload?.input || {};
        addLog(`🔧 调用工具: ${toolName}`);
        toolCalls.push({ toolName, args, result: null });
      } else if (type === 'tool-result') {
        // 工具执行结果
        const lastCall = toolCalls[toolCalls.length - 1];
        const result = payload?.result ?? payload?.output ?? null;
        if (lastCall && lastCall.result === null) {
          lastCall.result = result;
        }
        addLog(`✅ 工具执行完成`);

        // 特殊处理 write-file：拿到最终写入的文件
        if (lastCall && (lastCall.toolName === 'writeFile' || lastCall.toolName === 'write-file')) {
          const r: any = result;
          if (r && typeof r === 'object') {
            if (typeof r.path === 'string') writtenFilePath = r.path;
            if (typeof r.filePath === 'string') writtenFilePath = r.filePath;
            if (typeof r.content === 'string') writtenFileContent = r.content;
            // 一些工具把写入状态放在 result.success / result.message
          }
        }
      }
    }

    addLog(`Agent 输出完成，文本长度: ${fullText.length}, 工具调用次数: ${toolCalls.length}`);

    // 从工具结果中提取 coverage / execution
    let coverage: Record<string, number> | undefined;
    let execution: { passed: number; failed: number; skipped: number; duration: number } | undefined;

    for (const call of toolCalls) {
      const r: any = call.result;
      if (!r || typeof r !== 'object') continue;
      const toolName = call.toolName;
      // measureCoverage 返回 { line, branch, function } 或 { symbol_coverage, ... }
      if (toolName === 'measureCoverage' || toolName === 'measure-coverage') {
        if (typeof r.line === 'number') {
          coverage = {
            line: r.line,
            branch: r.branch ?? 0,
            function: r.function ?? 0,
          };
        } else if (typeof r.symbol_coverage === 'number') {
          coverage = {
            line: r.symbol_coverage,
            branch: r.branch_coverage ?? 0,
            function: r.function_coverage ?? 0,
          };
        }
      }
      // executeTests 返回 { passed, failed, errors, skipped, duration_ms, test_results }
      if (toolName === 'executeTests' || toolName === 'execute-tests') {
        const passed = Number(r.passed ?? 0);
        const failed = Number(r.failed ?? Number(r.errors ?? 0));
        const skipped = Number(r.skipped ?? 0);
        const duration = Number(r.duration_ms ?? r.duration ?? 0);
        execution = { passed, failed, skipped, duration };
      }
    }

    // 优先使用工具真正写入的内容（write-file 工具的结果）
    if (writtenFileContent) {
      testCode = writtenFileContent;
    } else {
      // 回退：从 LLM 文本中提取 ```code``` 块
      const codeMatch = fullText.match(/```(?:python|java|cpp|c\+\+)?\n([\s\S]*?)```/);
      if (codeMatch) {
        testCode = codeMatch[1];
      }
    }

    // 优先用工具返回的文件路径
    if (writtenFilePath) {
      testFile = writtenFilePath.split(/[\\/]/).pop() || writtenFilePath;
    } else {
      // 回退：推断文件名
      const extMap: Record<string, string> = {
        python: 'py',
        java: 'java',
        cpp: 'cpp',
      };
      const ext = extMap[language] || 'txt';
      testFile = `test_output_${Date.now()}.${ext}`;
    }

    const executionTime = Date.now() - startTime;
    addLog(`执行完成，耗时: ${executionTime}ms`);

    return {
      success: true,
      testCode,
      testFile,
      testFilePath: writtenFilePath || undefined,
      coverage,
      execution,
      executionTime,
      logs,
      fullText,
      toolCalls,
    };
  } catch (error: any) {
    const executionTime = Date.now() - startTime;
    addLog(`执行失败: ${error.message}`);

    return {
      success: false,
      executionTime,
      error: error.message,
      logs,
    };
  }
}

/**
 * 流式执行 Agent
 */
export async function executeAgentStream(
  input: string,
  language: string = 'python',
  apiKey: string,
  onChunk: (chunk: string) => void
): Promise<AgentExecutionResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  try {
    if (!apiKey) {
      throw new Error('未提供 API Key');
    }

    setupApiKey(apiKey);
    const { agent } = getWiredAutonomousAgent();

    const sessionId = `api-agent-stream-${Date.now()}`;
    memoryStore.getOrCreate(sessionId);

    const messages = [
      {
        role: 'user',
        content: input,
      },
    ];

    const stream = await (agent as any).stream(messages, {
      maxSteps: 25,
      modelSettings: { temperature: 0, maxOutputTokens: 4096 },
    });

    let fullText = '';

    for await (const chunk of stream.fullStream) {
      const type = (chunk as any).type;
      const payload = (chunk as any).payload;

      if (type === 'text-delta' && payload?.text) {
        fullText += payload.text;
        onChunk(payload.text);
      }
    }

    const codeMatch = fullText.match(/```(?:python|java|cpp|c\+\+)?\n([\s\S]*?)```/);
    const testCode = codeMatch ? codeMatch[1] : fullText;

    return {
      success: true,
      testCode,
      executionTime: Date.now() - startTime,
      logs,
      fullText,
    };
  } catch (error: any) {
    return {
      success: false,
      executionTime: Date.now() - startTime,
      error: error.message,
      logs,
    };
  }
}
