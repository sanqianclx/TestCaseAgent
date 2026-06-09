/**
 * 流式执行服务
 *
 * 真正调用现有的 autonomous agent 和 workflow，
 * 通过 SSE 流式输出每个步骤到前端。
 */

import { getWiredAutonomousAgent } from '../../autonomous/autonomous-agent.js';
import { memoryStore } from '../../mastra/memory/in-memory-store.js';
import { getActiveApiKey } from './llmKey.service.js';
import { registerGeneratedFile } from './file.service.js';
import { logger } from '../../mastra/runtime/logger.js';
import { runGenerateTestWorkflow } from './workflow-runner.js';
import { throwIfTaskRunCancelled } from './task-runtime-registry.js';
import { env } from '../config/env.js';

type StreamExecutionOptions = {
  taskId?: string;
  sessionId?: number;
  workspaceId?: number;
  outputDir?: string;
  sourceFile?: string;
  language?: string;
};

type AgentContinuationState = {
  reason: string;
  lastRunId?: string;
  lastUpdatedAt: string;
};

type AgentProgressState = {
  lastUpdatedAt: string;
  entries: string[];
};

const INCOMPLETE_FINISH_REASONS = new Set(['length', 'tool-calls', 'content-filter', 'error']);

/**
 * 流式回调
 */
export interface StreamCallbacks {
  onProgress: (event: { type: string; step?: string; message: string; progress?: number; data?: any }) => void;
  onComplete: (result: {
    success: boolean;
    testCode?: string;
    testFile?: string;
    error?: string;
    incomplete?: boolean;
    finishReason?: string;
    taskId?: string;
    previewFileId?: number | null;
    outputDir?: string;
  }) => void | Promise<void>;
  onIncomplete?: (result: {
    success: false;
    incomplete: true;
    finishReason: string;
    message: string;
    outputDir?: string;
  }) => void | Promise<void>;
  onError: (error: Error) => void | Promise<void>;
  /**
   * Agent 调用了 ask-user 工具，需要用户输入。
   * 调用方应该弹出对话框收集用户输入后，把答案作为新消息重发。
   */
  onAsk?: (info: {
    question: string;
    options?: string[];
    toolCallId?: string;
    runId?: string;
    toolName?: string;
    args?: Record<string, any>;
  }) => void;
}

type AgentToolCallRecord = { toolName: string; args: any; result: any };

function compactJson(value: unknown, maxLength = 1200): string {
  let text = '';
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function summarizeToolResult(call: AgentToolCallRecord): string {
  const args = call.args || {};
  const result = call.result || {};
  const toolName = call.toolName || 'unknown';

  if (toolName === 'writeFile' || toolName === 'write-file') {
    const filePath = result.path || result.filePath || result.file_path || args.path || args.filePath || '(unknown path)';
    const content = typeof result.content === 'string' ? result.content : typeof args.content === 'string' ? args.content : '';
    return `write-file 完成: ${filePath}${content ? `, content_chars=${content.length}` : ''}`;
  }

  if (toolName === 'executeTests' || toolName === 'execute-tests') {
    return `execute-tests 完成: language=${args.language || 'python'}, filename=${args.filename || args.source_file || ''}, status=${result.status}, passed=${Number(result.passed ?? 0)}, failed=${Number(result.failed ?? 0)}, errors=${Number(result.errors ?? 0)}, exit_code=${result.exit_code ?? 'n/a'}`;
  }

  if (toolName === 'measureCoverage' || toolName === 'measure-coverage') {
    return `measure-coverage 完成: language=${args.language || ''}, filename=${args.filename || args.source_file || ''}, ok=${Boolean(result.ok)}, line_rate=${Number(result.line_rate ?? 0)}, branch_rate=${Number(result.branch_rate ?? 0)}, tool=${result.tool || ''}${result.error ? `, error=${compactJson(result.error, 300)}` : ''}`;
  }

  if (toolName === 'parseSourceCode' || toolName === 'parse-source-code') {
    const symbols = Array.isArray(result.symbols) ? result.symbols.length : undefined;
    const functions = Array.isArray(result.functions) ? result.functions.length : undefined;
    const classes = Array.isArray(result.classes) ? result.classes.length : undefined;
    return `parse-source-code 完成: filename=${args.filename || args.path || ''}, module=${result.module_name || result.moduleName || ''}, symbols=${symbols ?? 'n/a'}, functions=${functions ?? 'n/a'}, classes=${classes ?? 'n/a'}`;
  }

  if (toolName === 'readFile' || toolName === 'read-file') {
    const text = typeof result.content === 'string' ? result.content : typeof result.text === 'string' ? result.text : '';
    return `read-file 完成: path=${args.path || result.path || ''}${text ? `, chars=${text.length}` : ''}`;
  }

  if (toolName === 'shellRun' || toolName === 'shell-run') {
    return `shell-run 完成: command=${compactJson(args.command || result.command || '', 180)}, exit_code=${result.exit_code ?? result.exitCode ?? 'n/a'}, timed_out=${Boolean(result.timed_out ?? result.timedOut)}`;
  }

  return `${toolName} 完成: args=${compactJson(args, 350)}, result=${compactJson(result, 650)}`;
}

export function rememberAgentToolResult(sessionId: string, call: AgentToolCallRecord): void {
  const summary = summarizeToolResult(call);
  memoryStore.addMessage(sessionId, 'tool', summary, {
    toolName: call.toolName,
    args: call.args,
  });
  const existing = memoryStore.getFact<string[]>(sessionId, 'agentProgressLog') || [];
  const entries = [...existing, summary].slice(-env.agent.memoryLimit);
  memoryStore.setFact(sessionId, 'agentProgressLog', entries);
  memoryStore.setFact(sessionId, 'agentProgressState', {
    lastUpdatedAt: new Date().toISOString(),
    entries,
  });
  memoryStore.setFact(sessionId, 'lastAgentToolResult', summary);
}

export function rememberAgentText(sessionId: string, text: string, metadata?: Record<string, unknown>): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  memoryStore.addMessage(sessionId, 'agent', trimmed, metadata);
  memoryStore.setFact(sessionId, 'lastAgentText', trimmed.slice(-2000));
}

export function isIncompleteAgentFinishReason(finishReason: string): boolean {
  return INCOMPLETE_FINISH_REASONS.has(finishReason);
}

/**
 * 流式执行 Autonomous Agent
 *
 * 直接调用现有的自主 Agent，使用它的 9 个工具
 */
export async function streamAutonomousAgent(
  userId: number,
  input: string,
  callbacks: StreamCallbacks,
  options: StreamExecutionOptions = {}
): Promise<void> {
  try {
    throwIfTaskRunCancelled(options.taskId);
    // 1. 检查 API Key
    const apiKey = await getActiveApiKey(userId);
    if (!apiKey) {
      await callbacks.onError(new Error('未配置 DeepSeek API Key，请先在 LLM 设置中添加'));
      return;
    }

    // 设置环境变量
    process.env.DEEPSEEK_API_KEY = apiKey;

    callbacks.onProgress({
      type: 'start',
      step: 'init',
      message: '启动自主 Agent...',
      progress: 0,
    });

    // 2. 获取 Agent
    const { agent } = getWiredAutonomousAgent();

    // 3. 使用稳定会话 ID，避免 Web 端每轮追问都丢失上下文。
    const sessionId = options.sessionId ? `api-agent-session-${options.sessionId}` : `api-agent-${Date.now()}`;
    memoryStore.getOrCreate(sessionId);
    if (!memoryStore.getFact<boolean>(sessionId, 'webAgentSessionInitialized')) {
      memoryStore.addMessage(sessionId, 'system', 'API Agent session started');
      memoryStore.setFact(sessionId, 'webAgentSessionInitialized', true);
    }

    callbacks.onProgress({
      type: 'progress',
      step: 'init',
      message: '接收用户消息...',
      progress: 5,
    });

    // 4. 记录用户消息
    memoryStore.addMessage(sessionId, 'user', input);

    // 5. 构建消息：把最近会话记忆交还给 Agent，避免反复读取/解析已处理文件。
    const memorySummary = memoryStore.summarize(sessionId, Math.max(18, Math.min(env.agent.memoryLimit, 40)));
    const continuationState = memoryStore.getFact<AgentContinuationState | null>(sessionId, 'agentContinuationNeeded');
    const progressState = memoryStore.getFact<AgentProgressState | null>(sessionId, 'agentProgressState');
    const outputDirInstruction =
      typeof options.outputDir === 'string' && options.outputDir.trim()
        ? `\n\n[系统约束]\n本次任务的目标输出目录是：${options.outputDir.trim()}\n除非用户另行明确指定，否则生成的测试文件、导出结果和中间产物都应放在这个目录下。`
        : '';
    const continuationInstruction = continuationState
      ? `\n\n[续跑约束]\n当前会话存在上一轮未完成的 Agent 运行状态（reason=${continuationState.reason}, lastUpdatedAt=${continuationState.lastUpdatedAt}）。必须先阅读上方 Facts/Recent messages 中的 agentProgressLog、lastAgentToolResult、lastAgentText，判断哪些文件/语言/步骤已经完成，哪些还没完成；不要重新开始，不要重复生成或重复执行已经完成的部分。若看到某一步失败，应从失败点继续修复。`
      : '';
    const progressInstruction = progressState
      ? `\n\n[进度约束]\n当前会话已有工具执行进度（lastUpdatedAt=${progressState.lastUpdatedAt}）。回答或继续任务前必须参考 agentProgressLog；已经完成的读取、解析、写入、测试执行和覆盖率测量不要无故重复。若用户要求补做/继续/完善，应从最近未完成或失败的步骤继续。`
      : '';
    const messages = [
      {
        role: 'user',
        content: memorySummary
          ? `以下是本 Web 会话的近期上下文。若源文件内容和附件未变化，不要重复读取或解析已经完成过的内容，直接基于已有结论继续。\n\n${memorySummary}\n\n当前用户消息：\n${input}${outputDirInstruction}${progressInstruction}${continuationInstruction}`
          : `${input}${outputDirInstruction}${progressInstruction}${continuationInstruction}`,
      },
    ];

    callbacks.onProgress({
      type: 'progress',
      step: 'thinking',
      message: 'Agent 正在分析请求...',
      progress: 10,
    });

    let fullText = '';
    let testCode = '';
    let testFile = '';
    // write-file 工具结果（如果 LLM 用 writeFile 写了文件）
    let writtenFileContent: string | null = null;
    let writtenFilePath: string | null = null;
    let latestRegisteredFileId: number | null = null;
    // 工具调用记录
    const toolCalls: AgentToolCallRecord[] = [];
    // 是否已经触发 ask-user（决定是否还要发 onComplete）
    let asked = false;
    // 挂起信息（从 chunk 累积）
    let suspendPayloadFromChunk: any = null;
    let lastRunId: string | null = null;
    let lastFinishReason: string | null = null;

    // 6. 流式调用 Agent
    // ask-user 检测策略：在 LLM 文本里匹配 <<ASK_USER:问题>> 标记
    // 出现则触发前端弹窗，让用户输入
    const stream = await (agent as any).stream(messages, {
      maxSteps: env.agent.maxSteps,
      experimental_continueSteps: true,
      modelSettings: { temperature: 0, maxOutputTokens: env.agent.maxOutputTokens },
    });

    callbacks.onProgress({
      type: 'progress',
      step: 'streaming',
      message: 'Agent 流式输出中...',
      progress: 20,
    });

    let progress = 20;
    let lastChunkType = '';

    for await (const chunk of stream.fullStream) {
      throwIfTaskRunCancelled(options.taskId);
      const type = (chunk as any).type;
      const payload = (chunk as any).payload;

      // 处理不同类型的 chunk
      if (type === 'text-delta' && payload?.text) {
        const text = payload.text;
        fullText += text;

        // 检测 ask-user 标记：<<ASK_USER:问题>>
        // LLM 在需要向用户确认时输出这个标记，我们就弹窗
        const askMatch = fullText.match(/<<ASK_USER:([\s\S]+?)>>/);
        if (askMatch && callbacks.onAsk && !asked) {
          const question = askMatch[1].trim();
          callbacks.onAsk({ question, options: undefined, toolCallId: undefined });
          asked = true;
          callbacks.onProgress({
            type: 'progress',
            step: 'awaiting-user-input',
            message: '等待你的输入...',
            progress: 60,
          });
          // 把标记从 fullText 中剥掉，避免最终保存到消息里
          fullText = fullText.replace(/<<ASK_USER:[\s\S]+?>>/, '').trim();
          return;
        }

        // 检测工具调用
        if (text.includes('读取') || text.includes('reading')) {
          callbacks.onProgress({
            type: 'tool',
            step: 'read-file',
            message: '正在读取文件...',
            progress: Math.min(progress + 2, 90),
          });
        } else if (text.includes('解析') || text.includes('parsing')) {
          callbacks.onProgress({
            type: 'tool',
            step: 'parse-source',
            message: '正在解析源代码...',
            progress: Math.min(progress + 3, 90),
          });
        } else if (text.includes('执行测试') || text.includes('execute')) {
          callbacks.onProgress({
            type: 'tool',
            step: 'execute-tests',
            message: '正在执行测试...',
            progress: Math.min(progress + 5, 90),
          });
        } else if (text.includes('覆盖率') || text.includes('coverage')) {
          callbacks.onProgress({
            type: 'tool',
            step: 'measure-coverage',
            message: '正在测量覆盖率...',
            progress: Math.min(progress + 5, 90),
          });
        } else if (text.includes('写入') || text.includes('writing')) {
          callbacks.onProgress({
            type: 'tool',
            step: 'write-file',
            message: '正在写入测试文件...',
            progress: Math.min(progress + 5, 90),
          });
        }

        // 累积进度
        if (lastChunkType !== 'text-delta') {
          progress = Math.min(progress + 1, 90);
        }
        lastChunkType = 'text-delta';

        // 输出文本到前端
        callbacks.onProgress({
          type: 'text',
          step: 'response',
          message: text,
          progress,
        });
      } else if (type === 'reasoning-delta') {
        const text = payload?.text ?? (chunk as any).delta ?? '';
        if (typeof text === 'string' && text.length > 0) {
          callbacks.onProgress({
            type: 'thinking',
            step: 'thinking',
            message: text,
            progress,
          });
        }
      } else if (type === 'tool-call') {
        const toolName = payload?.toolName || 'unknown';
        const args = payload?.args || payload?.input || {};
        toolCalls.push({ toolName, args, result: null });
        // 服务端日志：方便排查为什么没触发 ask
        logger.info('system', { scope: 'streamAutonomousAgent', event_name: 'tool-call', toolName, argsKeys: Object.keys(args) });
        callbacks.onProgress({
          type: 'tool',
          step: toolName,
          message: `调用工具: ${toolName}`,
          progress: Math.min(progress + 2, 85),
          data: {
            toolName,
            args,
          },
        });
      } else if (type === 'tool-call-suspended' || type === 'tool-suspended') {
        // 工具挂起：框架通知需要用户审批
        const sp = (payload as any)?.suspendPayload || payload;
        if (sp && typeof sp === 'object') {
          suspendPayloadFromChunk = sp;
          logger.info('system', {
            scope: 'streamAutonomousAgent',
            event_name: 'tool-call-suspended',
            toolName: (sp as any).toolName,
            toolCallId: (sp as any).toolCallId,
            runId: (sp as any).runId,
          });
        }
      } else if (type === 'finish') {
        // 记录 runId 和 finishReason
        const finishPayload = (payload as any) || chunk;
        if (finishPayload?.runId) lastRunId = finishPayload.runId;
        if (finishPayload?.finishReason) lastFinishReason = finishPayload.finishReason;
        if (finishPayload?.payload?.runId) lastRunId = finishPayload.payload.runId;
        if (finishPayload?.payload?.finishReason) lastFinishReason = finishPayload.payload.finishReason;
        // runId 也可能在 chunk 顶层
        if (!lastRunId && (chunk as any).runId) lastRunId = (chunk as any).runId;

        // 检测 ask-user 工具被调用：兜底发 ask 事件（如果 LLM 没输出 <<ASK_USER:..>> 标记）
        // 实际前端弹窗主要由文本标记 <<ASK_USER:...>> 触发
        const lastCall = toolCalls[toolCalls.length - 1];
        const toolName = lastCall?.toolName || '';
        const args = lastCall?.args || {};
        if (
          callbacks.onAsk &&
          (toolName === 'askUser' || toolName === 'ask-user' || toolName === 'ask_user')
        ) {
          const question =
            args?.question ||
            args?.prompt ||
            args?.message ||
            args?.text ||
            'Agent 需要你的输入';
          const options = Array.isArray(args?.options) ? args.options : undefined;
          const toolCallId = (payload as any)?.toolCallId;
          if (!asked) {
            callbacks.onAsk({ question, options, toolCallId });
            asked = true;
            callbacks.onProgress({
              type: 'progress',
              step: 'awaiting-user-input',
              message: '等待你的输入...',
              progress: 60,
            });
            return;
          }
        }
      } else if (type === 'tool-result') {
        const lastCall = toolCalls[toolCalls.length - 1];
        const result = payload?.result ?? payload?.output ?? null;
        if (lastCall && lastCall.result === null) {
          lastCall.result = result;
        }
        if (lastCall) {
          rememberAgentToolResult(sessionId, lastCall);
        }

        // 抓 writeFile 工具的内容/路径
        if (lastCall && (lastCall.toolName === 'writeFile' || lastCall.toolName === 'write-file')) {
          const r: any = result;
          if (r && typeof r === 'object') {
            if (typeof r.path === 'string') writtenFilePath = r.path;
            if (typeof r.filePath === 'string') writtenFilePath = r.filePath;
            if (typeof r.file_path === 'string') writtenFilePath = r.file_path;
            if (typeof r.content === 'string') writtenFileContent = r.content;
          }
          if (!writtenFileContent && typeof lastCall.args?.content === 'string') {
            writtenFileContent = lastCall.args.content;
          }
          if (!writtenFilePath) {
            writtenFilePath =
              typeof lastCall.args?.path === 'string'
                ? lastCall.args.path
                : typeof lastCall.args?.filePath === 'string'
                ? lastCall.args.filePath
                : null;
          }

          if (writtenFileContent && options.sessionId) {
            try {
              const ext =
                options.language === 'python'
                  ? 'py'
                  : options.language === 'java'
                  ? 'java'
                  : options.language === 'cpp'
                  ? 'cpp'
                  : 'txt';
              const reg = await registerGeneratedFile({
                userId,
                sessionId: options.sessionId,
                workspaceId: options.workspaceId,
                filename:
                  (writtenFilePath ? writtenFilePath.split(/[\\/]/).pop() : '') ||
                  `test_output_${Date.now()}.${ext}`,
                content: writtenFileContent,
                purpose: 'test_output',
                metadata: {
                  language: options.language || 'python',
                  sourceFile: options.sourceFile,
                  kind: 'unit_test',
                  outputPath: writtenFilePath,
                },
              });
              latestRegisteredFileId = reg.id;
            } catch (regErr: any) {
              logger.warn('system', {
                scope: 'streamAutonomousAgent',
                event_name: 'registerGeneratedFile.realtime.failed',
                error: regErr.message,
              });
            }
          }
        }

        const summary = lastCall ? summarizeToolResult(lastCall) : '工具执行完成';
        callbacks.onProgress({
          type: 'tool-result',
          step: 'tool',
          message: summary,
          progress: Math.min(progress + 3, 90),
          data: {
            toolName: lastCall?.toolName || '',
            args: lastCall?.args || null,
            result,
            filePath: writtenFilePath,
            content: writtenFileContent,
            registeredFileId: latestRegisteredFileId,
          },
        });
      }
    }

    // ========== 统一检查挂起状态 ==========
    // Mastra 框架在 requireApproval 工具调用时挂起 stream，
    // 此时 finishReason === 'suspended'，suspendPayload 在 fullOutput 里
    let fullOutput: any = null;
    try {
      fullOutput = await (stream as any).getFullOutput?.();
    } catch (e: any) {
      logger.warn('system', { scope: 'streamAutonomousAgent', event_name: 'getFullOutput.failed', error: e?.message });
    }

    const finalFinishReason = (fullOutput?.finishReason as string | undefined) ?? lastFinishReason ?? '';
    const finalRunId = (fullOutput?.runId as string | undefined) ?? lastRunId ?? '';
    const finalText = typeof fullOutput?.text === 'string' ? fullOutput.text : fullText;

    if (!asked && (finalFinishReason === 'suspended' || suspendPayloadFromChunk)) {
      throwIfTaskRunCancelled(options.taskId);
      // 提取挂起信息
      const sp: any =
        suspendPayloadFromChunk ||
        (fullOutput?.suspendPayload as Record<string, unknown>) ||
        {};
      const toolName = (sp.toolName as string) || '';
      const toolCallId = (sp.toolCallId as string) || '';
      const args = (sp.args as Record<string, any>) || {};
      const runId = (sp.runId as string) || finalRunId;

      if (callbacks.onAsk && toolName && toolCallId && runId) {
        // 决定前端要展示什么
        let question = '';
        if (toolName === 'askUser') {
          question =
            (args.question as string) ||
            (args.prompt as string) ||
            'Agent 需要你的输入';
        } else if (toolName === 'writeFile' || toolName === 'write-file') {
          const path = (args.path as string) || (args.filePath as string) || '?';
          question = `Agent 想写入文件：${path}`;
        } else if (toolName === 'shellRun' || toolName === 'shell-run') {
          const cmd = (args.command as string) || '?';
          question = `Agent 想执行 shell 命令：\n\`\`\`\n${cmd}\n\`\`\``;
        } else if (toolName === 'exportCases' || toolName === 'export-cases') {
          const dir = (args.output_dir as string) || '?';
          question = `Agent 想导出测试到：${dir}`;
        } else {
          question = `Agent 想调用工具 ${toolName}，请确认`;
        }

        callbacks.onAsk({
          question,
          options: undefined,
          toolCallId,
          runId,
          toolName,
          args,
        });
        logger.info('system', { scope: 'streamAutonomousAgent', event_name: 'ask', toolName, toolCallId, runId });
        // 不 res.end()，让前端 keep-alive
        // 走 early return 跳过 onComplete
        callbacks.onProgress({
          type: 'progress',
          step: 'awaiting-user-approval',
          message: '等待你的确认...',
          progress: 60,
        });
        return;
      }
    }

    if (isIncompleteAgentFinishReason(finalFinishReason)) {
      rememberAgentText(sessionId, finalText, {
        finishReason: finalFinishReason,
        runId: finalRunId,
        source: 'stream-incomplete',
      });
      memoryStore.setFact(sessionId, 'agentContinuationNeeded', {
        reason: finalFinishReason,
        lastRunId: finalRunId,
        lastUpdatedAt: new Date().toISOString(),
      });
      callbacks.onProgress({
        type: 'progress',
        step: 'incomplete',
        message: `Agent 本轮达到模型限制（${finalFinishReason}），已保存当前进度；发送“继续”会从断点接着做。`,
        progress: 90,
      });
      const message = `Agent 本轮未自然完成：${finalFinishReason}。进度已保存，请发送“继续”接着执行。`;
      if (callbacks.onIncomplete) {
        await callbacks.onIncomplete({
          success: false,
          incomplete: true,
          finishReason: finalFinishReason,
          message,
          outputDir: options.outputDir,
        });
      } else {
        await callbacks.onComplete({
          success: false,
          incomplete: true,
          finishReason: finalFinishReason,
          error: message,
          outputDir: options.outputDir,
        });
      }
      return;
    }

    // 7. 提取测试代码：优先用 writeFile 工具真正写入的内容
    // ask 模式下：跳过 onComplete / 入库 / 进度消息
    if (asked) {
      callbacks.onProgress({
        type: 'progress',
        step: 'awaiting-user-input',
        message: '已通知前端等待用户输入...',
        progress: 60,
      });
      return;
    }

    if (writtenFileContent) {
      throwIfTaskRunCancelled(options.taskId);
      testCode = writtenFileContent;
      if (writtenFilePath) {
        testFile = writtenFilePath.split(/[\\/]/).pop() || writtenFilePath;
      }
    } else {
      const codeMatch = fullText.match(/```(?:python|java|cpp|c\+\+)?\n([\s\S]*?)```/);
      if (codeMatch) {
        testCode = codeMatch[1];

        // 尝试提取文件名
        const fileMatch = fullText.match(/(?:file|文件名)[:：]\s*(\S+\.\w+)/i);
        testFile = fileMatch ? fileMatch[1] : 'test_output.py';
      }
    }

    callbacks.onProgress({
      type: 'progress',
      step: 'register',
      message: '正在保存测试代码到文件库...',
      progress: 95,
    });

    // 8. 把测试代码入库
    let previewFileId: number | null = null;
    if (testCode) {
      throwIfTaskRunCancelled(options.taskId);
      if (latestRegisteredFileId && writtenFileContent && testCode === writtenFileContent) {
        previewFileId = latestRegisteredFileId;
      } else {
        try {
          const lang = options.language || 'python';
          const ext = lang === 'python' ? 'py' : lang === 'java' ? 'java' : lang === 'cpp' ? 'cpp' : 'txt';
          const reg = await registerGeneratedFile({
            userId,
            sessionId: options.sessionId,
            workspaceId: options.workspaceId,
            filename: testFile || `test_output_${Date.now()}.${ext}`,
            content: testCode,
            purpose: 'test_output',
            metadata: {
              language: lang,
              sourceFile: options.sourceFile,
              kind: 'unit_test',
              outputPath: writtenFilePath,
            },
          });
          previewFileId = reg.id;
        } catch (regErr: any) {
          logger.warn('system', { scope: 'streamAutonomousAgent', event_name: 'registerGeneratedFile.failed', error: regErr.message });
        }
      }
    }

    callbacks.onProgress({
      type: 'progress',
      step: 'complete',
      message: 'Agent 执行完成',
      progress: 100,
    });

    await callbacks.onComplete({
      success: true,
      testCode,
      testFile,
      previewFileId,
      outputDir: options.outputDir,
    });
    if (finalText.trim()) {
      rememberAgentText(sessionId, finalText, { previewFileId, testFile, finishReason: finalFinishReason });
      memoryStore.setFact(sessionId, 'agentContinuationNeeded', null);
    }

  } catch (error: any) {
    logger.error('system', { scope: 'streamAutonomousAgent', error: error.message, stack: error.stack });
    await callbacks.onError(error);
  }
}

/**
 * 流式执行 Workflow
 *
 * 直接调用现有的 generateTestWorkflow
 */
export async function streamWorkflow(
  userId: number,
  sourceCode: string,
  sourceFile: string,
  language: string,
  requirements: string,
  callbacks: StreamCallbacks,
  options: StreamExecutionOptions = {}
): Promise<void> {
  try {
    throwIfTaskRunCancelled(options.taskId);
    // 1. 检查 API Key
    const apiKey = await getActiveApiKey(userId);
    if (!apiKey) {
      await callbacks.onError(new Error('未配置 DeepSeek API Key'));
      return;
    }

    process.env.DEEPSEEK_API_KEY = apiKey;

    callbacks.onProgress({
      type: 'start',
      step: 'init',
      message: '启动 Workflow 流水线...',
      progress: 0,
    });

    // 2. 7 步流水线
    const steps = [
      { step: 'parse', message: '步骤 1/7: 读取并解析源文件...', delay: 500 },
      { step: 'design', message: '步骤 2/7: 设计测试用例...', delay: 800 },
      { step: 'exportPlan', message: '步骤 3/7: 导出测试计划...', delay: 400 },
      { step: 'generate', message: '步骤 4/7: 生成测试代码...', delay: 1000 },
      { step: 'execute', message: '步骤 5/7: 执行测试...', delay: 1500 },
      { step: 'heal', message: '步骤 6/7: 自愈修复（如需要）...', delay: 800 },
      { step: 'export', message: '步骤 7/7: 导出结果...', delay: 500 },
    ];

    let progress = 0;
    for (const step of steps) {
      throwIfTaskRunCancelled(options.taskId);
      callbacks.onProgress({
        type: 'progress',
        step: step.step,
        message: step.message,
        progress: progress,
      });
      await new Promise(r => setTimeout(r, step.delay));
      progress += 14;
    }

    // 3. 实际调用工作流
    callbacks.onProgress({
      type: 'progress',
      step: 'workflow',
      message: '执行 7 步工作流...',
      progress: 90,
    });

    const workflowOutputDir = options.outputDir || `./output/workflow-${Date.now()}`;

    let testCode = '';
    let testFile = '';
    const result = await runGenerateTestWorkflow({
      sourceCode,
      sourceFile: sourceFile || 'input',
      language,
      requirements,
      maxAttempts: 3,
      outputDir: workflowOutputDir,
      onTrace: (event) => {
        callbacks.onProgress({
          type: 'trace',
          step: event.step,
          message: event.message,
          progress: event.progress,
          data: event.data,
        });
      },
    });
    testCode = result.test_code || '';
    testFile =
      result.exported_files?.find((file) => /test/i.test(file)) ||
      (language === 'python' ? 'test_output.py' : language === 'java' ? 'TestOutput.java' : 'test_output.cpp');

    callbacks.onProgress({
      type: 'progress',
      step: 'register',
      message: '正在保存测试代码到文件库...',
      progress: 96,
    });

    // 把测试代码入库
    let previewFileId: number | null = null;
    if (testCode) {
      throwIfTaskRunCancelled(options.taskId);
      try {
        const ext = language === 'python' ? 'py' : language === 'java' ? 'java' : language === 'cpp' ? 'cpp' : 'txt';
        const reg = await registerGeneratedFile({
          userId,
          sessionId: options.sessionId,
          workspaceId: options.workspaceId,
          filename: testFile || `test_output_${Date.now()}.${ext}`,
          content: testCode,
          purpose: 'test_output',
          metadata: { language, sourceFile, kind: 'unit_test', outputPath: testFile ? `${workflowOutputDir}/${testFile}` : workflowOutputDir },
        });
        previewFileId = reg.id;
      } catch (regErr: any) {
        logger.warn('system', { scope: 'streamWorkflow', event_name: 'registerGeneratedFile.failed', error: regErr.message });
      }
    }

    callbacks.onProgress({
      type: 'progress',
      step: 'complete',
      message: 'Workflow 执行完成',
      progress: 100,
    });

    await callbacks.onComplete({
      success: true,
      testCode,
      testFile,
      previewFileId,
      outputDir: workflowOutputDir,
    });

  } catch (error: any) {
    logger.error('system', { scope: 'streamWorkflow', error: error.message });
    await callbacks.onError(error);
  }
}
