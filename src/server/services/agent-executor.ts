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
 * 执行结果
 */
export interface AgentExecutionResult {
  success: boolean;
  testCode?: string;
  testFile?: string;
  coverage?: Record<string, number>;
  executionTime: number;
  error?: string;
  logs: string[];
  fullText?: string;
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
    const stream = await (agent as any).stream(messages, {
      maxSteps,
      modelSettings: { temperature: 0, maxOutputTokens: 4096 },
    });

    let fullText = '';
    let testCode = '';
    let testFile = '';

    addLog('Agent 流式输出中...');

    // 处理流式输出
    for await (const chunk of stream.fullStream) {
      const type = (chunk as any).type;
      const payload = (chunk as any).payload;

      if (type === 'text-delta' && payload?.text) {
        fullText += payload.text;
      }
    }

    addLog(`Agent 输出完成，文本长度: ${fullText.length}`);

    // 提取测试代码
    const codeMatch = fullText.match(/```(?:python|java|cpp|c\+\+)?\n([\s\S]*?)```/);
    if (codeMatch) {
      testCode = codeMatch[1];
    }

    // 推断文件名
    const extMap: Record<string, string> = {
      python: 'py',
      java: 'java',
      cpp: 'cpp',
    };
    const ext = extMap[language] || 'txt';
    testFile = `test_output_${Date.now()}.${ext}`;

    const executionTime = Date.now() - startTime;
    addLog(`执行完成，耗时: ${executionTime}ms`);

    return {
      success: true,
      testCode,
      testFile,
      executionTime,
      logs,
      fullText,
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
