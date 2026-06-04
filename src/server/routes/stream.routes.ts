/**
 * 流式路由
 *
 * SSE (Server-Sent Events) 流式输出 AI 对话
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { streamAutonomousAgent, streamWorkflow } from '../services/stream.service.js';

const router = Router();

/**
 * POST /api/v1/stream/agent
 * 流式执行自主 Agent
 */
router.post('/agent', authenticate, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { content, mode, sourceCode, sourceFile, language } = req.body;

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
      sendEvent('complete', e);
      res.end();
    },
    onError: (e: Error) => {
      sendEvent('error', { message: e.message });
      res.end();
    },
  };

  if (mode === 'workflow' && sourceCode) {
    // Workflow 模式
    await streamWorkflow(userId, sourceCode, sourceFile, language || 'python', content, callbacks);
  } else {
    // Agent 模式
    await streamAutonomousAgent(userId, content, callbacks);
  }
});

export default router;
