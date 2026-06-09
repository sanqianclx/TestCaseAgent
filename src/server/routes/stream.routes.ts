/**
 * 流式路由
 *
 * SSE (Server-Sent Events) 流式输出 AI 对话
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  isIncompleteAgentFinishReason,
  rememberAgentText,
  rememberAgentToolResult,
  streamAutonomousAgent,
  streamWorkflow,
} from '../services/stream.service.js';
import { registerGeneratedFile } from '../services/file.service.js';
import {
  registerTaskRun,
  throwIfTaskRunCancelled,
  TaskCancelledError,
  unregisterTaskRun,
} from '../services/task-runtime-registry.js';
import prisma from '../config/database.js';
import { logger } from '../../mastra/runtime/logger.js';
import { generateUUID } from '../utils/crypto.js';

const router = Router();

/**
 * 从 fileContent 拉取用户上传的附件，拼到 prompt 中
 *
 * @param userId 用户 ID
 * @param fileIds 文件 ID 列表
 * @returns 拼装好的附件 markdown 块
 */
async function resolveSessionFileIds(userId: number, params: { fileIds?: number[]; sessionId?: number }): Promise<number[]> {
  const explicitIds = Array.isArray(params.fileIds)
    ? params.fileIds.map(Number).filter((id) => Number.isFinite(id) && id > 0)
    : [];

  if (explicitIds.length > 0) {
    if (params.sessionId) {
      await prisma.uploadedFile.updateMany({
        where: { id: { in: explicitIds }, userId },
        data: { sessionId: params.sessionId },
      }).catch((error: any) => {
        logger.warn('system', { scope: 'stream/agent', event_name: 'uploadedFile.attachSession.failed', error: error?.message });
      });
    }
    return explicitIds;
  }

  if (!params.sessionId) return [];
  const sessionFiles = await prisma.uploadedFile.findMany({
    where: { userId, sessionId: params.sessionId, purpose: 'source' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return sessionFiles.map((file: any) => Number(file.id));
}

async function buildAttachmentsBlock(userId: number, fileIds: number[]): Promise<string> {
  if (!Array.isArray(fileIds) || fileIds.length === 0) return '';
  const files = await prisma.uploadedFile.findMany({
    where: { id: { in: fileIds }, userId },
    include: { contents: { take: 1, orderBy: { chunkIndex: 'asc' } } },
  });
  const blocks = files
    .filter((f: any) => f.contents && f.contents.length > 0)
    .map((f: any) => {
      const c = f.contents[0].content?.toString('utf-8') || '';
      const truncated = c.length > 32 * 1024 ? c.slice(0, 32 * 1024) + '\n... (已截断)' : c;
      const lang = (() => {
        try {
          return (f.metadata && JSON.parse(f.metadata).language) || '';
        } catch {
          return '';
        }
      })();
      return `### 附件: ${f.originalName}\n\`\`\`${lang}\n${truncated}\n\`\`\``;
    });
  return blocks.join('\n\n');
}

async function resolveWorkflowSourceInput(
  userId: number,
  params: {
    sourceCode?: string;
    sourceFile?: string;
    language?: string;
    fileIds?: number[];
  }
): Promise<{ sourceCode: string; sourceFile: string; language: string }> {
  if (typeof params.sourceCode === 'string' && params.sourceCode.trim()) {
    return {
      sourceCode: params.sourceCode,
      sourceFile: params.sourceFile || 'chat-input',
      language: params.language || inferLanguage(params.sourceFile || ''),
    };
  }

  const firstFileId = Array.isArray(params.fileIds) ? params.fileIds[0] : undefined;
  if (!firstFileId) {
    throw new Error('Workflow 模式需要上传或选择一个源代码文件');
  }

  const file = await prisma.uploadedFile.findFirst({
    where: { id: firstFileId, userId },
    include: { contents: { take: 1, orderBy: { chunkIndex: 'asc' } } },
  });

  if (!file || !file.contents?.[0]) {
    throw new Error('Workflow 源文件不存在或内容为空');
  }

  const sourceFile = params.sourceFile || file.originalName;
  return {
    sourceCode: file.contents[0].content?.toString('utf-8') || '',
    sourceFile,
    language: params.language || inferLanguage(sourceFile),
  };
}

function inferLanguage(sourceFile: string): string {
  const ext = sourceFile.split('.').pop()?.toLowerCase();
  if (ext === 'py') return 'python';
  if (ext === 'java') return 'java';
  if (ext === 'cpp' || ext === 'cc' || ext === 'cxx' || ext === 'c') return 'cpp';
  return 'python';
}

function parseSessionContext(context: unknown): Record<string, any> | null {
  if (!context) return null;
  if (typeof context === 'string') {
    try {
      return JSON.parse(context);
    } catch {
      return null;
    }
  }
  if (typeof context === 'object') {
    return context as Record<string, any>;
  }
  return null;
}

/**
 * POST /api/v1/stream/agent
 * 流式执行自主 Agent
 */
router.post('/agent', authenticate, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const {
    content,
    mode,
    sourceCode,
    sourceFile,
    language,
    outputDir,
    fileIds,
    sessionId,
    workspaceId,
    taskId,
  } = req.body;

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const resolvedMode = mode === 'workflow' ? 'workflow' : 'autonomous';
  const createdTaskId = taskId || generateUUID();
  const resolvedSessionId = sessionId ? Number(sessionId) : undefined;
  let resolvedLanguage = language || 'python';
  const resolvedSourceFile = sourceFile || 'chat-input';

  let sessionRecord:
    | {
        workspaceId: bigint | null;
        context: unknown;
        workspace: { id: bigint; basePath: string | null } | null;
      }
    | null = null;
  if (resolvedSessionId) {
    sessionRecord = await prisma.session.findFirst({
      where: { id: resolvedSessionId, userId },
      select: {
        workspaceId: true,
        context: true,
        workspace: {
          select: {
            id: true,
            basePath: true,
          },
        },
      },
    });
  }

  const explicitWorkspaceId = workspaceId ? Number(workspaceId) : undefined;
  let workspaceRecord:
    | {
        id: number;
        basePath: string | null;
      }
    | null = null;
  const candidateWorkspaceId = explicitWorkspaceId ?? (sessionRecord?.workspaceId ? Number(sessionRecord.workspaceId) : undefined);
  if (candidateWorkspaceId) {
    if (sessionRecord?.workspace && Number(sessionRecord.workspace.id) === candidateWorkspaceId) {
      workspaceRecord = {
        id: Number(sessionRecord.workspace.id),
        basePath: sessionRecord.workspace.basePath,
      };
    } else {
      const dbWorkspace = await prisma.workspace.findFirst({
        where: { id: candidateWorkspaceId, userId },
        select: {
          id: true,
          basePath: true,
        },
      });
      workspaceRecord = dbWorkspace
        ? {
            id: Number(dbWorkspace.id),
            basePath: dbWorkspace.basePath,
          }
        : null;
    }
  }

  const sessionContext = parseSessionContext(sessionRecord?.context) || {};
  const resolvedWorkspaceId = workspaceRecord?.id ?? explicitWorkspaceId;
  const resolvedOutputDir =
    typeof outputDir === 'string' && outputDir.trim()
      ? outputDir.trim()
      : typeof sessionContext.outputDir === 'string' && sessionContext.outputDir.trim()
      ? sessionContext.outputDir.trim()
      : workspaceRecord?.basePath || undefined;

  let workflowSourceInput: { sourceCode: string; sourceFile: string; language: string } | null = null;
  const resolvedFileIds = await resolveSessionFileIds(userId, {
    fileIds,
    sessionId: resolvedSessionId,
  });

  if (resolvedMode === 'workflow') {
    try {
      workflowSourceInput = await resolveWorkflowSourceInput(userId, {
        sourceCode,
        sourceFile: resolvedSourceFile,
        language: resolvedLanguage,
        fileIds: resolvedFileIds,
      });
      resolvedLanguage = workflowSourceInput.language;
    } catch (e: any) {
      sendEvent('error', { message: e?.message || 'Workflow 源文件解析失败', taskId: createdTaskId });
      return res.end();
    }
  }

  try {
    await prisma.task.create({
      data: {
        userId,
        workspaceId: resolvedWorkspaceId,
        sessionId: resolvedSessionId,
        taskId: createdTaskId,
        status: 'running',
        mode: resolvedMode as any,
        sourceFile: workflowSourceInput?.sourceFile || resolvedSourceFile,
        sourceContent: workflowSourceInput?.sourceCode || sourceCode || content || '',
        language: resolvedLanguage,
        requirements: content || '',
        outputDir: resolvedOutputDir,
        attemptCount: 0,
        startedAt: new Date(),
      },
    });
    await prisma.taskLog.create({
      data: {
        taskId: createdTaskId,
        sessionId: resolvedSessionId,
        level: 'info',
        step: 'start',
        message: `开始 ${resolvedMode === 'workflow' ? 'Workflow' : 'Agent'} 流式执行`,
      },
    });
    registerTaskRun(createdTaskId, {
      sessionId: resolvedSessionId,
      workspaceId: resolvedWorkspaceId,
      outputDir: resolvedOutputDir,
    });
  } catch (e: any) {
    logger.error('system', { scope: 'stream/agent', event_name: 'task.create.failed', error: e?.message });
    sendEvent('error', { message: `创建任务记录失败: ${e?.message || '未知错误'}` });
    unregisterTaskRun(createdTaskId);
    return res.end();
  }

  let askSent = false;
  const callbacks = {
    onProgress: (e: any) => {
      sendEvent('progress', e);
    },
    onComplete: async (e: any) => {
      try {
        await prisma.task.update({
          where: { taskId: createdTaskId },
          data: {
            status: 'completed',
            outputDir: e.outputDir || resolvedOutputDir,
            result: {
              testCode: e.testCode || '',
              testFile: e.testFile || '',
              previewFileId: e.previewFileId ?? null,
              outputDir: e.outputDir || resolvedOutputDir,
            },
            executionTime: null,
            completedAt: new Date(),
          },
        });
        await prisma.taskLog.create({
          data: {
            taskId: createdTaskId,
            sessionId: resolvedSessionId,
            level: 'info',
            step: 'complete',
            message: '流式执行完成',
            metadata: { previewFileId: e.previewFileId ?? null, testFile: e.testFile || '' },
          },
        });
      } catch (err: any) {
        logger.warn('system', { scope: 'stream/agent', event_name: 'task.complete.failed', error: err?.message });
      }
      sendEvent('complete', { ...e, taskId: createdTaskId });
      unregisterTaskRun(createdTaskId);
      res.end();
    },
    onIncomplete: async (e: any) => {
      try {
        await prisma.task.update({
          where: { taskId: createdTaskId },
          data: {
            status: 'completed',
            outputDir: e.outputDir || resolvedOutputDir,
            result: {
              incomplete: true,
              finishReason: e.finishReason || '',
              message: e.message || '',
              outputDir: e.outputDir || resolvedOutputDir,
            },
            errorMessage: null,
            completedAt: new Date(),
          },
        });
        await prisma.taskLog.create({
          data: {
            taskId: createdTaskId,
            sessionId: resolvedSessionId,
            level: 'info',
            step: 'incomplete',
            message: e.message || 'Agent 本轮未完成，等待继续',
            metadata: { finishReason: e.finishReason || '' },
          },
        });
      } catch (err: any) {
        logger.warn('system', { scope: 'stream/agent', event_name: 'task.incomplete.failed', error: err?.message });
      }
      sendEvent('complete', { ...e, taskId: createdTaskId });
      unregisterTaskRun(createdTaskId);
      res.end();
    },
    onError: async (e: Error) => {
      const isCancelled = e instanceof TaskCancelledError;
      try {
        await prisma.task.update({
          where: { taskId: createdTaskId },
          data: {
            status: isCancelled ? 'cancelled' : 'failed',
            errorMessage: isCancelled ? '任务已取消' : e.message,
            completedAt: new Date(),
          },
        });
        await prisma.taskLog.create({
          data: {
            taskId: createdTaskId,
            sessionId: resolvedSessionId,
            level: isCancelled ? 'info' : 'error',
            step: isCancelled ? 'cancel' : 'error',
            message: isCancelled ? '任务已取消' : e.message,
          },
        });
      } catch (err: any) {
        logger.warn('system', { scope: 'stream/agent', event_name: 'task.error.failed', error: err?.message });
      }
      sendEvent('error', { message: e.message, taskId: createdTaskId });
      unregisterTaskRun(createdTaskId);
      res.end();
    },
    onAsk: (info: any) => {
      // Agent 调用了 ask-user 工具：发 ask 事件给前端弹窗
      // 本次 SSE 在 stream 返回后结束；前端回答后通过 /resume 继续。
      askSent = true;
      sendEvent('ask', { ...info, taskId: createdTaskId });
    },
  };

  // 把上传的附件内容拼到 prompt
  let enrichedContent = content || '';
  try {
    const attachBlock = await buildAttachmentsBlock(userId, resolvedFileIds);
    if (attachBlock) {
      enrichedContent = `${content || ''}\n\n## 用户上传的附件\n\n${attachBlock}`;
    }
  } catch (e: any) {
    // 忽略附件注入失败
  }

  const streamOptions = {
    taskId: createdTaskId,
    sessionId: resolvedSessionId,
    workspaceId: resolvedWorkspaceId,
    outputDir: resolvedOutputDir,
    sourceFile: workflowSourceInput?.sourceFile || resolvedSourceFile,
    language: resolvedLanguage,
  };

  if (resolvedMode === 'workflow' && workflowSourceInput) {
    // Workflow 模式
    await streamWorkflow(
      userId,
      workflowSourceInput.sourceCode,
      workflowSourceInput.sourceFile,
      resolvedLanguage,
      content || '',
      callbacks,
      streamOptions
    );
  } else {
    // Agent 模式
    await streamAutonomousAgent(userId, enrichedContent, callbacks, streamOptions);
  }
  if (askSent && !res.writableEnded) {
    res.end();
  }
});

/**
 * POST /api/v1/stream/agent/resume
 * 恢复被挂起的 Agent stream（用户对审批做出决定后）
 *
 * Body: { runId, toolCallId, decision: 'approve' | 'decline', answer?: string }
 */
router.post('/agent/resume', authenticate, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { runId, toolCallId, decision, answer, toolName: pendingToolName, taskId, sessionId, workspaceId, sourceFile, language } = req.body || {};

  if (!runId || !toolCallId) {
    res.status(400).write(`event: error\ndata: ${JSON.stringify({ message: '缺少 runId 或 toolCallId' })}\n\n`);
    return res.end();
  }
  if (decision !== 'approve' && decision !== 'decline') {
    res.status(400).write(`event: error\ndata: ${JSON.stringify({ message: 'decision 必须是 approve 或 decline' })}\n\n`);
    return res.end();
  }

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    if (taskId) {
      const existingTask = await prisma.task.findFirst({
        where: { taskId, userId },
        select: { status: true },
      });
      if (!existingTask) {
        sendEvent('error', { message: '任务不存在', taskId });
        unregisterTaskRun(taskId);
        return res.end();
      }
      if (existingTask.status === 'cancelled') {
        sendEvent('error', { message: '任务已取消', taskId });
        unregisterTaskRun(taskId);
        return res.end();
      }
    }

    const { getWiredAutonomousAgent } = await import('../../autonomous/autonomous-agent.js');
    const { agent } = getWiredAutonomousAgent();
    const { memoryStore } = await import('../../mastra/memory/in-memory-store.js');

    // 把用户的审批决定注入到 in-memory store（让 Agent 真的"记得"用户的回答）
    // 这与 CLI 的 resumeAfterAskUser / resolveApproval 一致
    try {
      const toolMsg = JSON.stringify({
        tool: pendingToolName || 'tool',
        decision,
        answer: answer || '(no answer)',
      });
      const memorySessionId = sessionId ? `api-agent-session-${Number(sessionId)}` : `api-agent-resume-${runId}`;
      memoryStore.addMessage(memorySessionId, 'tool', toolMsg, {
        toolName: pendingToolName || 'tool',
        toolCallId,
        decision,
      });
    } catch (e: any) {
      logger.warn('system', { scope: 'stream/agent/resume', event_name: 'memoryStore.addMessage.failed', error: e?.message });
    }

    const resumeStream =
      decision === 'approve'
        ? await (agent as any).approveToolCall({ runId, toolCallId })
        : await (agent as any).declineToolCall({ runId, toolCallId });

    sendEvent('progress', {
      type: 'progress',
      step: 'resumed',
      message: `▶️ Agent 已${decision === 'approve' ? '继续执行' : '收到拒绝信号'}`,
      progress: 30,
    });

    // 把 resume stream 转发给前端（流式 chunk）
    // 同步累积 runId / finishReason / suspendPayload，模拟 streamAutonomousAgent 的逻辑
    let suspendPayloadFromChunk: any = null;
    let lastRunId: string | null = null;
    let lastFinishReason: string | null = null;
    let progress = 30;
    let writtenFileContent: string | null = null;
    let writtenFilePath: string | null = null;
    let testCode = '';
    let testFile = '';
    const toolCalls: Array<{ toolName: string; args: any; result: any }> = [];
    const memorySessionId = sessionId ? `api-agent-session-${Number(sessionId)}` : `api-agent-resume-${runId}`;
    let fullText = '';
    for await (const chunk of (resumeStream as any).fullStream) {
      throwIfTaskRunCancelled(taskId);
      const type = (chunk as any).type;
      const payload = (chunk as any).payload;
      if (type === 'text-delta' && payload?.text) {
        fullText += payload.text;
        sendEvent('progress', {
          type: 'text',
          step: 'response',
          message: payload.text,
        });
      } else if (type === 'tool-call') {
        const toolName = payload?.toolName || 'unknown';
        const args = payload?.args || payload?.input || {};
        toolCalls.push({ toolName, args, result: null });
        progress = Math.min(progress + 8, 88);
        sendEvent('progress', {
          type: 'tool',
          step: toolName,
          message: `🔧 调用工具: ${toolName}`,
          progress,
        });
      } else if (type === 'tool-call-suspended' || type === 'tool-suspended') {
        const sp = payload?.suspendPayload || payload;
        if (sp && typeof sp === 'object') {
          suspendPayloadFromChunk = sp;
        }
      } else if (type === 'tool-result') {
        const lastCall = toolCalls[toolCalls.length - 1];
        const result = payload?.result ?? payload?.output ?? null;
        if (lastCall && lastCall.result === null) {
          lastCall.result = result;
        }
        if (lastCall) {
          rememberAgentToolResult(memorySessionId, lastCall);
        }
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
        }
        progress = Math.min(progress + 4, 92);
        sendEvent('progress', {
          type: 'tool-result',
          step: 'tool',
          message: '✅ 工具执行完成',
          progress,
        });
      } else if (type === 'finish') {
        const finishPayload = payload || chunk;
        if (finishPayload?.runId) lastRunId = finishPayload.runId;
        if (finishPayload?.finishReason) lastFinishReason = finishPayload.finishReason;
        if (finishPayload?.payload?.runId) lastRunId = finishPayload.payload.runId;
        if (finishPayload?.payload?.finishReason) lastFinishReason = finishPayload.payload.finishReason;
        if (!lastRunId && (chunk as any).runId) lastRunId = (chunk as any).runId;
        sendEvent('progress', {
          type: 'progress',
          step: 'finished',
          message: '执行完成',
          progress: 100,
        });
      }
    }

    // 检查 stream 是否以 suspended 结束（resume 后又触发新工具挂起）
    let fullOutput: any = null;
    try {
      fullOutput = await (resumeStream as any).getFullOutput?.();
    } catch (e: any) {
      logger.warn('system', { scope: 'stream/agent/resume', event_name: 'getFullOutput.failed', error: e?.message });
    }

    const finalFinishReason = (fullOutput?.finishReason as string | undefined) ?? lastFinishReason ?? '';
    const finalRunId = (fullOutput?.runId as string | undefined) ?? lastRunId ?? '';
    const finalText = typeof fullOutput?.text === 'string' ? fullOutput.text : fullText;

    if (finalFinishReason === 'suspended' || suspendPayloadFromChunk) {
      throwIfTaskRunCancelled(taskId);
      // resume 后又挂起：再发 ask 事件让前端继续弹"待审批"
      const sp: any =
        suspendPayloadFromChunk ||
        (fullOutput?.suspendPayload as Record<string, unknown>) ||
        {};
      const toolName = (sp.toolName as string) || '';
      const toolCallId = (sp.toolCallId as string) || '';
      const args = (sp.args as Record<string, any>) || {};
      const runId = (sp.runId as string) || finalRunId;

      if (toolName && toolCallId && runId) {
        // 生成问题描述（与 stream.service.ts 保持一致）
        let question = '';
        if (toolName === 'askUser' || toolName === 'ask-user') {
          question = (args.question as string) || 'Agent 需要你的输入';
        } else if (toolName === 'writeFile' || toolName === 'write-file') {
          const p = (args.path as string) || '?';
          question = `Agent 想写入文件：${p}`;
        } else if (toolName === 'shellRun' || toolName === 'shell-run') {
          const c = (args.command as string) || '?';
          question = `Agent 想执行 shell 命令：\n\`\`\`\n${c}\n\`\`\``;
        } else if (toolName === 'exportCases' || toolName === 'export-cases') {
          const d = (args.output_dir as string) || '?';
          question = `Agent 想导出测试到：${d}`;
        } else {
          question = `Agent 想调用工具 ${toolName}，请确认`;
        }

        sendEvent('ask', { question, runId, toolCallId, toolName, args });
        res.end();
        return;
      }
    }

    if (finalText.trim()) {
      rememberAgentText(memorySessionId, finalText, { source: 'resume', finishReason: finalFinishReason, runId: finalRunId });
    }

    if (isIncompleteAgentFinishReason(finalFinishReason)) {
      const pauseMessage = `Agent 审批恢复后未自然完成：${finalFinishReason}。进度已保存，请发送“继续”接着执行。`;
      try {
        if (taskId) {
          await prisma.task.update({
            where: { taskId },
            data: {
              status: 'completed',
              result: {
                incomplete: true,
                finishReason: finalFinishReason,
                message: pauseMessage,
              },
              errorMessage: null,
              completedAt: new Date(),
            },
          });
          await prisma.taskLog.create({
            data: {
              taskId,
              sessionId: sessionId ? Number(sessionId) : undefined,
              level: 'info',
              step: 'incomplete',
              message: pauseMessage,
              metadata: { finishReason: finalFinishReason, runId: finalRunId },
            },
          });
        }
      } catch (e: any) {
        logger.warn('system', { scope: 'stream/agent/resume', event_name: 'task.incomplete.failed', error: e?.message });
      }
      sendEvent('complete', { success: false, incomplete: true, finishReason: finalFinishReason, message: pauseMessage, error: pauseMessage, taskId });
      if (taskId) unregisterTaskRun(taskId);
      res.end();
      return;
    }

    if (writtenFileContent) {
      testCode = writtenFileContent;
      testFile = writtenFilePath ? writtenFilePath.split(/[\\/]/).pop() || writtenFilePath : '';
    }

    let previewFileId: number | null = null;
    if (testCode) {
      try {
        const lang = language || 'python';
        const ext = lang === 'python' ? 'py' : lang === 'java' ? 'java' : lang === 'cpp' ? 'cpp' : 'txt';
        const reg = await registerGeneratedFile({
          userId,
          sessionId: sessionId ? Number(sessionId) : undefined,
          workspaceId: workspaceId ? Number(workspaceId) : undefined,
          filename: testFile || `test_output_${Date.now()}.${ext}`,
          content: testCode,
          purpose: 'test_output',
          metadata: {
            language: lang,
            sourceFile,
            kind: 'unit_test',
            resumedFrom: runId,
            outputPath: writtenFilePath,
          },
        });
        previewFileId = reg.id;
      } catch (e: any) {
        logger.warn('system', { scope: 'stream/agent/resume', event_name: 'registerGeneratedFile.failed', error: e?.message });
      }
    }

    if (taskId) {
      try {
        await prisma.task.update({
          where: { taskId },
          data: {
            status: 'completed',
            result: {
              testCode,
              testFile,
              previewFileId,
            },
            completedAt: new Date(),
          },
        });
        await prisma.taskLog.create({
          data: {
            taskId,
            sessionId: sessionId ? Number(sessionId) : undefined,
            level: 'info',
            step: 'complete',
            message: '审批后继续执行完成',
            metadata: { previewFileId, testFile },
          },
        });
      } catch (e: any) {
        logger.warn('system', { scope: 'stream/agent/resume', event_name: 'task.complete.failed', error: e?.message });
      }
    }

    sendEvent('complete', { success: true, testCode, testFile, previewFileId, taskId });
    if (taskId) unregisterTaskRun(taskId);
    res.end();
  } catch (err: any) {
    const isCancelled = err instanceof TaskCancelledError;
    if (taskId) {
      try {
        await prisma.task.update({
          where: { taskId },
          data: {
            status: isCancelled ? 'cancelled' : 'failed',
            errorMessage: isCancelled ? '任务已取消' : err?.message || 'resume 失败',
            completedAt: new Date(),
          },
        });
      } catch {
        // ignore task update failure while reporting the original stream error
      }
      unregisterTaskRun(taskId);
    }
    sendEvent('error', { message: isCancelled ? '任务已取消' : err?.message || 'resume 失败', taskId });
    res.end();
  }
});

export default router;
