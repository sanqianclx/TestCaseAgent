/**
 * 配置路由
 */

import { Router } from 'express';
import { sendSuccess } from '../utils/response.js';
import { prisma } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/v1/config/llm
 * 获取 LLM 配置状态
 */
router.get('/llm', authenticate, async (req: any, res, next) => {
  try {
    let userHasKey = false;
    let activeKey = null;

    if (req.user) {
      const allKeys = await prisma.apiKey.findMany({
        where: { userId: BigInt(req.user.id) },
        select: { id: true, userId: true, isActive: true, prefix: true },
      });

      activeKey = await prisma.apiKey.findFirst({
        where: {
          userId: BigInt(req.user.id),
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          prefix: true,
          createdAt: true,
        },
      });
      userHasKey = !!activeKey;
    }

    sendSuccess(res, {
      provider: 'deepseek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      temperature: 0.3,
      maxTokens: 4096,
      userHasKey,
      activeKey,
      message: userHasKey
        ? '已配置 API Key'
        : '请在 LLM 设置页面添加您的 DeepSeek API Key',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
