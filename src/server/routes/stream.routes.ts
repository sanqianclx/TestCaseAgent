/**
 * 流式路由
 *
 * SSE (Server-Sent Events) 流式输出 AI 对话
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { streamAutonomousAgent, streamWorkflow } from '../services/stream.service.js';
import prisma from '../config/database.js';
import { logger } from '../../mastra/runtime/logger.js';

const router = Router();

/**
 * 从 fileContent 拉取用户上传的附件，拼到 prompt 中
 *
 * @param userId 用户 ID
 * @param fileIds 文件 ID 列表
 * @returns 拼装好的附件 markdown 块
 */
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

  const callbacks = {
    onProgress: (e: any) => {
      sendEvent('progress', e);
    },
    onComplete: (e: any) => {
      sendEvent('complete', { ...e, taskId });
      res.end();
    },
    onError: (e: Error) => {
      sendEvent('error', { message: e.message, taskId });
      res.end();
    },
    onAsk: (info: any) => {
      // Agent 调用了 ask-user 工具：发 ask 事件给前端弹窗
      // 不 res.end() —— 弹窗会让用户回答，回答后前端发新请求继续 stream
      sendEvent('ask', { ...info, taskId });
    },
  };

  // 把上传的附件内容拼到 prompt
  let enrichedContent = content || '';
  try {
    const attachBlock = await buildAttachmentsBlock(userId, fileIds || []);
    if (attachBlock) {
      enrichedContent = `${content || ''}\n\n## 用户上传的附件\n\n${attachBlock}`;
    }
  } catch (e: any) {
    // 忽略附件注入失败
  }

  const streamOptions = {
    sessionId: sessionId ? Number(sessionId) : undefined,
    workspaceId: workspaceId ? Number(workspaceId) : undefined,
    outputDir,
    sourceFile,
    language,
  };

  if (mode === 'workflow' && (sourceCode || enrichedContent)) {
    // Workflow 模式
    await streamWorkflow(
      userId,
      sourceCode || enrichedContent,
      sourceFile,
      language || 'python',
      enrichedContent,
      callbacks,
      streamOptions
    );
  } else {
    // Agent 模式
    await streamAutonomousAgent(userId, enrichedContent, callbacks, streamOptions);
  }
});

/**
 * POST /api/v1/stream/agent/resume
 * 恢复被挂起的 Agent stream（用户对审批做出决定后）
 *
 * Body: { runId, toolCallId, decision: 'approve' | 'decline', answer?: string }
 */
router.post('/agent/resume', authenticate, async (req: Request, res: Response) => {
  const { runId, toolCallId, decision, answer } = req.body || {};

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
    const { getWiredAutonomousAgent } = await import('../../autonomous/autonomous-agent.js');
    const { agent } = getWiredAutonomousAgent();
    const { memoryStore } = await import('../../mastra/memory/in-memory-store.js');

    // 把用户的审批决定注入到 in-memory store（让 Agent 真的"记得"用户的回答）
    // 这与 CLI 的 resumeAfterAskUser / resolveApproval 一致
    try {
      const toolMsg = JSON.stringify({
        tool: toolName,
        decision,
        answer: answer || '(no answer)',
      });
      // 不需要准确的 sessionId——Mastra 框架以 runId 区分 run，
      // memoryStore 注入只是辅助上下文
      const sessionId = `api-agent-resume-${runId}`;
      memoryStore.addMessage(sessionId, 'tool', toolMsg, {
        toolName,
        toolCallId,
        decision,
      });
    } catch (e: any) {
      logger.warn?.('stream/agent/resume: memoryStore addMessage failed', { error: e?.message });
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
    for await (const chunk of (resumeStream as any).fullStream) {
      const type = (chunk as any).type;
      const payload = (chunk as any).payload;
      if (type === 'text-delta' && payload?.text) {
        sendEvent('progress', {
          type: 'text',
          step: 'response',
          message: payload.text,
        });
      } else if (type === 'tool-call') {
        const toolName = payload?.toolName || 'unknown';
        sendEvent('progress', {
          type: 'tool',
          step: toolName,
          message: `🔧 调用工具: ${toolName}`,
        });
      } else if (type === 'tool-call-suspended' || type === 'tool-suspended') {
        const sp = payload?.suspendPayload || payload;
        if (sp && typeof sp === 'object') {
          suspendPayloadFromChunk = sp;
        }
      } else if (type === 'tool-result') {
        sendEvent('progress', {
          type: 'tool-result',
          step: 'tool',
          message: '✅ 工具执行完成',
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
      logger.warn?.('stream/agent/resume: getFullOutput failed', { error: e?.message });
    }

    const finalFinishReason = (fullOutput?.finishReason as string | undefined) ?? lastFinishReason ?? '';
    const finalRunId = (fullOutput?.runId as string | undefined) ?? lastRunId ?? '';

    if (finalFinishReason === 'suspended' || suspendPayloadFromChunk) {
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
        // 不 res.end() —— 等待用户再次审批
        return;
      }
    }

    sendEvent('complete', { success: true });
    res.end();
  } catch (err: any) {
    sendEvent('error', { message: err?.message || 'resume 失败' });
    res.end();
  }
});

export default router;
