/**
 * API Key 路由
 */

import { Router } from 'express';
import * as apiKeyController from '../controllers/apiKey.controller.js';
import { authenticate } from '../middleware/auth.js';
import {
  validateBody,
  validateQuery,
  validateParams,
  paginationSchema,
  idParamSchema,
} from '../middleware/validator.js';
import { z } from 'zod';

const router = Router();

router.use(authenticate);

/**
 * API Key 查询参数验证模式
 */
const apiKeyQuerySchema = paginationSchema.extend({
  isActive: z.string().optional().transform(val => val === 'true' ? true : val === 'false' ? false : undefined),
});

/**
 * GET /api/v1/api-keys/stats
 */
router.get('/stats', apiKeyController.getApiKeyStats);

/**
 * POST /api/v1/api-keys/test
 * 测试 API Key
 */
router.post('/test', apiKeyController.testApiKey);

/**
 * GET /api/v1/api-keys
 */
router.get('/', validateQuery(apiKeyQuerySchema), apiKeyController.getApiKeys);

/**
 * POST /api/v1/api-keys
 */
router.post('/', apiKeyController.createApiKey);

/**
 * POST /api/v1/api-keys/:id/activate
 */
router.post('/:id/activate', validateParams(idParamSchema), apiKeyController.activateApiKey);

/**
 * POST /api/v1/api-keys/:id/deactivate
 */
router.post('/:id/deactivate', validateParams(idParamSchema), apiKeyController.deactivateApiKey);

/**
 * DELETE /api/v1/api-keys/:id
 */
router.delete('/:id', validateParams(idParamSchema), apiKeyController.deleteApiKey);

export default router;
