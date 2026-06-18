# API 接口详细设计文档

> 📌 **实现状态注记（2026-06-11）**：本文档含设计稿与实际实现两部分内容。下方「实际端点总览」为权威清单（与 `src/server/routes/` 一一对应）；正文中标注 ⚠️ 的章节为设计稿中规划但**当前未实现**的端点，保留以备后续迭代参考。

## 📡 API 总览

### 基础信息

| 项目 | 值 |
|------|-----|
| Base URL | `/api/v1` |
| 认证方式 | Bearer Token / API Key |
| 数据格式 | JSON |
| 字符编码 | UTF-8 |

### 实际端点总览（与代码一致）

| 模块 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 健康检查 | GET | `/health` | 服务状态 |
| 认证 | POST | `/auth/register` | 用户注册 |
| 认证 | POST | `/auth/login` | 用户登录 |
| 认证 | POST | `/auth/refresh` | 刷新 Token |
| 认证 | POST | `/auth/logout` | 退出登录 |
| 认证 | GET | `/auth/me` | 获取当前用户 |
| 认证 | PUT | `/auth/profile` | 更新个人资料 |
| 认证 | PUT | `/auth/password` | 修改密码 |
| API Key | GET | `/api-keys` | 列表 |
| API Key | GET | `/api-keys/stats` | 使用统计 |
| API Key | POST | `/api-keys` | 创建 |
| API Key | POST | `/api-keys/test` | 测试 Key 有效性 |
| API Key | POST | `/api-keys/:id/activate` | 启用 |
| API Key | POST | `/api-keys/:id/deactivate` | 停用 |
| API Key | DELETE | `/api-keys/:id` | 删除 |
| 工作空间 | GET | `/workspaces` | 列表 |
| 工作空间 | POST | `/workspaces` | 创建 |
| 工作空间 | GET | `/workspaces/:id` | 详情 |
| 工作空间 | PUT | `/workspaces/:id` | 更新 |
| 工作空间 | DELETE | `/workspaces/:id` | 删除 |
| 工作空间 | POST | `/workspaces/:id/validate` | 验证工作目录 |
| 工作空间 | GET | `/workspaces/:id/files` | 浏览目录文件 |
| 文件 | GET | `/files` | 列表 |
| 文件 | GET | `/files/stats` | 统计 |
| 文件 | POST | `/files/upload` | 上传单文件 |
| 文件 | POST | `/files/upload-multiple` | 批量上传（≤10） |
| 文件 | GET | `/files/:id` | 详情 |
| 文件 | GET | `/files/:id/content` | 获取内容 |
| 文件 | DELETE | `/files/:id` | 删除 |
| 文件 | POST | `/files/:id/analyze` | AST 分析 |
| 会话 | GET | `/sessions` | 列表 |
| 会话 | GET | `/sessions/stats` | 统计 |
| 会话 | POST | `/sessions` | 创建 |
| 会话 | GET | `/sessions/:id` | 详情 |
| 会话 | PUT | `/sessions/:id` | 更新 |
| 会话 | DELETE | `/sessions/:id` | 删除（软删除） |
| 会话 | POST | `/sessions/:id/archive` | 归档 |
| 会话 | GET | `/sessions/:id/messages` | 消息历史 |
| 会话 | POST | `/sessions/:id/messages` | 发送消息 |
| 会话 | GET | `/sessions/:id/output-files` | 列出会话产物文件 |
| 会话 | GET | `/sessions/:id/output-file` | 读取单个产物文件 |
| 任务 | GET | `/tasks` | 列表 |
| 任务 | GET | `/tasks/stats` | 统计 |
| 任务 | POST | `/tasks` | 创建 |
| 任务 | GET | `/tasks/:taskId` | 详情 |
| 任务 | GET | `/tasks/:taskId/logs` | 日志 |
| 任务 | GET | `/tasks/:taskId/result` | 结果 |
| 任务 | POST | `/tasks/:taskId/cancel` | 取消 |
| 任务 | POST | `/tasks/:taskId/retry` | 重试 |
| 任务 | DELETE | `/tasks/:taskId` | 删除 |
| 配置 | GET | `/config/llm` | 读取 LLM 配置 |
| 流式 | POST | `/stream/agent` | SSE 流式运行 Agent |
| 流式 | POST | `/stream/agent/resume` | SSE 恢复挂起的 Agent 会话 |

### 统一响应格式

```typescript
// 成功响应
{
  code: 0,
  message: "success",
  data: T,
  timestamp: number
}

// 错误响应
{
  code: number,      // 错误码
  message: string,   // 错误信息
  details?: any,     // 详细信息
  timestamp: number
}

// 分页响应
{
  code: 0,
  message: "success",
  data: {
    items: T[],
    total: number,
    page: number,
    pageSize: number,
    totalPages: number
  }
}
```

---

## 🔐 认证接口 (Auth)

### POST /auth/register - 用户注册

**请求**：
```typescript
{
  username: string;      // 3-50 字符，字母数字下划线
  email: string;         // 有效邮箱
  password: string;      // 8-100 字符，包含大小写和数字
}
```

**响应**：
```typescript
{
  code: 0,
  data: {
    user: {
      id: number;
      username: string;
      email: string;
      role: string;
      createdAt: string;
    },
    accessToken: string;     // JWT Token (2小时)
    refreshToken: string;    // Refresh Token (7天)
  }
}
```

**错误码**：
- `1005` - 邮箱已存在
- `1006` - 用户名已存在
- `1007` - 密码强度不足

---

### POST /auth/login - 用户登录

**请求**：
```typescript
{
  email: string;
  password: string;
  rememberMe?: boolean;    // 是否记住登录
}
```

**响应**：
```typescript
{
  code: 0,
  data: {
    user: User,
    accessToken: string,
    refreshToken: string
  }
}
```

---

### POST /auth/refresh - 刷新 Token

**请求**：
```typescript
{
  refreshToken: string;
}
```

**响应**：
```typescript
{
  code: 0,
  data: {
    accessToken: string,
    refreshToken: string
  }
}
```

---

### GET /auth/me - 获取当前用户

**响应**：
```typescript
{
  code: 0,
  data: {
    id: number;
    username: string;
    email: string;
    avatarUrl: string | null;
    role: string;
    preferences: object;
    createdAt: string;
  }
}
```

---

### PUT /auth/profile - 更新个人资料

**请求**：
```typescript
{
  username?: string;
  avatarUrl?: string;
  preferences?: {
    theme?: 'light' | 'dark';
    language?: 'zh-CN' | 'en-US';
    defaultModel?: string;
    maxAttempts?: number;
    autoApprove?: boolean;
  }
}
```

---

### PUT /auth/password - 修改密码

**请求**：
```typescript
{
  oldPassword: string;
  newPassword: string;      // 8-100 字符
}
```

---

## 🔑 API Key 接口

### GET /api-keys - 获取 API Key 列表

**查询参数**：
```typescript
{
  page?: number;           // 默认 1
  pageSize?: number;       // 默认 20
  isActive?: boolean;      // 筛选状态
}
```

**响应**：
```typescript
{
  code: 0,
  data: {
    items: [{
      id: number;
      name: string;
      prefix: string;        // 如 "tg_abc123"
      permissions: string[];
      rateLimit: number;
      expiresAt: string | null;
      lastUsedAt: string | null;
      usageCount: number;
      isActive: boolean;
      createdAt: string;
    }],
    total: number,
    page: number,
    pageSize: number
  }
}
```

---

### POST /api-keys - 创建 API Key

**请求**：
```typescript
{
  name: string;                    // API Key 名称
  permissions?: string[];          // 默认 ["read", "generate"]
  rateLimit?: number;              // 默认 100
  expiresIn?: number | null;       // 过期天数，null 表示永不过期
}
```

**响应**：
```typescript
{
  code: 0,
  data: {
    id: number;
    name: string;
    key: string;                   // 完整 Key（仅此一次返回）
    prefix: string;
    permissions: string[];
    expiresAt: string | null;
    createdAt: string;
  }
}
```

**注意**：`key` 字段仅在创建时返回一次，之后无法再获取完整 Key。

---

### ⚠️ GET /api-keys/:id - 获取 API Key 详情（设计稿，未实现）

**响应**：
```typescript
{
  code: 0,
  data: {
    id: number;
    name: string;
    prefix: string;
    permissions: string[];
    rateLimit: number;
    expiresAt: string | null;
    lastUsedAt: string | null;
    lastUsedIp: string | null;
    usageCount: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  }
}
```

---

### ⚠️ PUT /api-keys/:id - 更新 API Key（设计稿，未实现，当前以 activate/deactivate 替代）

**请求**：
```typescript
{
  name?: string;
  permissions?: string[];
  rateLimit?: number;
  isActive?: boolean;
}
```

---

### DELETE /api-keys/:id - 删除 API Key

**响应**：
```typescript
{
  code: 0,
  message: "API Key deleted successfully"
}
```

---

### ⚠️ POST /api-keys/:id/regenerate - 重新生成 API Key（设计稿，未实现）

**响应**：
```typescript
{
  code: 0,
  data: {
    id: number;
    key: string;                   // 新的完整 Key
    prefix: string;
  }
}
```

---

## 📁 工作空间接口 (Workspaces)

### GET /workspaces - 获取工作空间列表

**响应**：
```typescript
{
  code: 0,
  data: {
    items: [{
      id: number;
      name: string;
      basePath: string;
      description: string | null;
      isDefault: boolean;
      settings: object;
      lastAccessedAt: string | null;
      createdAt: string;
    }],
    total: number
  }
}
```

---

### POST /workspaces - 创建工作空间

**请求**：
```typescript
{
  name: string;                    // 工作空间名称
  basePath: string;                // 工作目录绝对路径
  description?: string;            // 描述
  isDefault?: boolean;             // 是否默认
  settings?: {
    defaultLanguage?: string;
    maxAttempts?: number;
    llmRetries?: number;
    outputDir?: string;
    excludePatterns?: string[];
    autoDetectLanguage?: boolean;
  }
}
```

**响应**：
```typescript
{
  code: 0,
  data: {
    id: number;
    name: string;
    basePath: string;
    settings: object;
    createdAt: string;
  }
}
```

**错误码**：
- `4001` - 路径不存在
- `4002` - 路径无权限
- `4003` - 名称已存在

---

### GET /workspaces/:id - 获取工作空间详情

---

### PUT /workspaces/:id - 更新工作空间

**请求**：
```typescript
{
  name?: string;
  description?: string;
  isDefault?: boolean;
  settings?: object;
}
```

---

### DELETE /workspaces/:id - 删除工作空间

---

### POST /workspaces/:id/validate - 验证工作目录

**响应**：
```typescript
{
  code: 0,
  data: {
    valid: boolean;
    exists: boolean;
    readable: boolean;
    writable: boolean;
    files: {
      total: number;
      byLanguage: {
        python: number;
        java: number;
        cpp: number;
        other: number;
      }
    }
  }
}
```

---

### GET /workspaces/:id/files - 浏览工作空间文件

**查询参数**：
```typescript
{
  path?: string;           // 子目录路径
  pattern?: string;        // 文件名模式
  language?: string;       // 语言筛选
  recursive?: boolean;     // 是否递归
}
```

**响应**：
```typescript
{
  code: 0,
  data: {
    currentPath: string;
    parentPath: string | null;
    files: [{
      name: string;
      path: string;
      type: 'file' | 'directory';
      size: number | null;
      language: string | null;
      lastModified: string;
    }]
  }
}
```

---

## 📤 文件上传接口 (Files)

### POST /files/upload - 上传文件

**请求**：`multipart/form-data`

```
file: File                     // 文件
workspaceId?: number           // 工作空间 ID
sessionId?: number             // 会话 ID
purpose?: string               // 用途：source | reference | config | other
```

**响应**：
```typescript
{
  code: 0,
  data: {
    id: number;
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    language: string | null;
    createdAt: string;
  }
}
```

**限制**：
- 单文件最大：10 MB
- 支持格式：.py, .java, .cpp, .h, .hpp, .c, .txt, .md
- 同时上传文件数：最多 10 个

---

### POST /files/upload-multiple - 批量上传

**请求**：`multipart/form-data`

```
files: File[]                  // 多个文件
workspaceId?: number
sessionId?: number
purpose?: string
```

**响应**：
```typescript
{
  code: 0,
  data: {
    uploaded: [{
      id: number;
      filename: string;
      originalName: string;
      size: number;
    }],
    failed: [{
      filename: string;
      error: string;
    }]
  }
}
```

---

### GET /files - 获取文件列表

**查询参数**：
```typescript
{
  page?: number;
  pageSize?: number;
  workspaceId?: number;
  sessionId?: number;
  purpose?: string;
}
```

---

### GET /files/:id - 获取文件详情

**响应**：
```typescript
{
  code: 0,
  data: {
    id: number;
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    path: string;
    language: string | null;
    metadata: object;
    isProcessed: boolean;
    createdAt: string;
  }
}
```

---

### GET /files/:id/content - 获取文件内容

**响应**：
```typescript
{
  code: 0,
  data: {
    id: number;
    filename: string;
    content: string;           // 文件内容
    encoding: string;
    lineCount: number;
  }
}
```

---

### DELETE /files/:id - 删除文件

---

### POST /files/:id/analyze - 分析文件

**响应**：
```typescript
{
  code: 0,
  data: {
    language: string;
    lineCount: number;
    functionCount: number;
    classCount: number;
    imports: string[];
    functions: [{
      name: string;
      line: number;
      params: string[];
      returnType: string | null;
    }],
    classes: [{
      name: string;
      line: number;
      methods: string[];
    }]
  }
}
```

---

## 💬 会话接口 (Sessions)

### GET /sessions - 获取会话列表

**查询参数**：
```typescript
{
  page?: number;
  pageSize?: number;
  status?: 'active' | 'archived' | 'deleted';
  workspaceId?: number;
}
```

**响应**：
```typescript
{
  code: 0,
  data: {
    items: [{
      id: number;
      title: string;
      status: string;
      messageCount: number;
      totalTokens: number;
      workspace: {
        id: number;
        name: string;
      } | null;
      lastMessageAt: string | null;
      createdAt: string;
    }],
    total: number,
    page: number,
    pageSize: number
  }
}
```

---

### POST /sessions - 创建会话

**请求**：
```typescript
{
  title?: string;                // 会话标题
  workspaceId?: number;          // 关联工作空间
  modelConfig?: {
    provider?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
  }
}
```

**响应**：
```typescript
{
  code: 0,
  data: {
    id: number;
    title: string;
    status: string;
    workspace: object | null;
    modelConfig: object;
    createdAt: string;
  }
}
```

---

### GET /sessions/:id - 获取会话详情

---

### PUT /sessions/:id - 更新会话

**请求**：
```typescript
{
  title?: string;
  status?: 'active' | 'archived';
  modelConfig?: object;
}
```

---

### DELETE /sessions/:id - 删除会话（软删除）

---

### POST /sessions/:id/archive - 归档会话

---

### GET /sessions/:id/messages - 获取消息历史

**查询参数**：
```typescript
{
  page?: number;
  pageSize?: number;         // 默认 50
  before?: string;           // 消息 ID（用于加载更多）
  role?: string;             // 筛选角色
}
```

**响应**：
```typescript
{
  code: 0,
  data: {
    items: [{
      id: number;
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      messageType: string;
      metadata: object | null;
      tokenUsage: object | null;
      parentId: number | null;
      createdAt: string;
    }],
    total: number,
    hasMore: boolean,
    oldestId: number | null
  }
}
```

---

### POST /sessions/:id/messages - 发送消息

**请求**：
```typescript
{
  content: string;               // 消息内容
  messageType?: string;          // 默认 text
  metadata?: object;
  fileIds?: number[];            // 关联的文件 ID
  taskMode?: 'workflow' | 'autonomous';  // 任务模式
}
```

**响应**：
```typescript
{
  code: 0,
  data: {
    userMessage: Message;        // 用户消息
    assistantMessage: Message;   // AI 回复（流式则为空）
    taskId: string | null;       // 如果触发了任务
  }
}
```

---

### ⚠️ POST /sessions/:id/messages/stream - 流式发送消息（设计稿，未实现，流式能力由 POST /stream/agent 提供）

**请求**：同上

**响应**：Server-Sent Events (SSE)

```
event: message_start
data: {"messageId": 123}

event: content_delta
data: {"content": "正在"}

event: content_delta
data: {"content": "分析"}

event: content_delta
data: {"content": "代码..."}

event: reasoning_delta
data: {"reasoning": "让我看看这段代码..."}

event: tool_call
data: {"tool": "parse-source-code", "args": {...}}

event: tool_result
data: {"tool": "parse-source-code", "result": {...}}

event: message_end
data: {"messageId": 123, "tokenUsage": {...}}

event: task_created
data: {"taskId": "uuid", "status": "pending"}
```

---

## 🎯 任务接口 (Tasks)

### GET /tasks - 获取任务列表

**查询参数**：
```typescript
{
  page?: number;
  pageSize?: number;
  status?: string;           // pending | running | completed | failed | cancelled
  workspaceId?: number;
  sessionId?: number;
  language?: string;
  startDate?: string;
  endDate?: string;
}
```

**响应**：
```typescript
{
  code: 0,
  data: {
    items: [{
      id: number;
      taskId: string;
      status: string;
      mode: string;
      sourceFile: string;
      language: string;
      executionTime: number | null;
      tokenUsage: object | null;
      attemptCount: number;
      createdAt: string;
      completedAt: string | null;
    }],
    total: number,
    page: number,
    pageSize: number
  }
}
```

---

### POST /tasks - 创建任务

**请求**：
```typescript
{
  sourceFile?: string;           // 源文件路径（工作空间内）
  sourceContent?: string;        // 或直接传源代码
  fileId?: number;               // 或传上传文件 ID
  language?: string;             // 自动检测
  workspaceId?: number;
  sessionId?: number;
  mode?: 'workflow' | 'autonomous';
  requirements?: string;
  maxAttempts?: number;
  llmRetries?: number;
}
```

**响应**：
```typescript
{
  code: 0,
  data: {
    taskId: string;
    status: 'pending';
    session: {
      id: number;
      title: string;
    };
    createdAt: string;
  }
}
```

---

### GET /tasks/:taskId - 获取任务详情

**响应**：
```typescript
{
  code: 0,
  data: {
    id: number;
    taskId: string;
    status: string;
    mode: string;
    sourceFile: string;
    sourceContent: string;
    language: string;
    requirements: string | null;
    result: {
      testCode: string;
      testFile: string;
      coverage: {
        line: number;
        branch: number;
        function: number;
      };
      execution: {
        passed: number;
        failed: number;
        skipped: number;
        duration: number;
      };
      exportedFiles: string[];
    } | null;
    errorMessage: string | null;
    executionTime: number | null;
    tokenUsage: object | null;
    attemptCount: number;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
  }
}
```

---

### GET /tasks/:taskId/logs - 获取任务日志

**查询参数**：
```typescript
{
  level?: string;            // info | warn | error | debug | step
  step?: string;
  limit?: number;
  offset?: number;
}
```

**响应**：
```typescript
{
  code: 0,
  data: {
    logs: [{
      id: number;
      level: string;
      step: string | null;
      message: string;
      metadata: object | null;
      createdAt: string;
    }],
    total: number
  }
}
```

---

### ⚠️ GET /tasks/:taskId/stream - 任务状态流（设计稿，未实现，可轮询 GET /tasks/:taskId）

**响应**：Server-Sent Events (SSE)

```
event: status_change
data: {"status": "running", "step": "parse"}

event: log
data: {"level": "info", "step": "parse", "message": "开始解析源代码..."}

event: progress
data: {"step": "design", "progress": 50, "total": 100}

event: result
data: {"testCode": "...", "coverage": {...}}

event: error
data: {"message": "执行失败", "details": {...}}

event: complete
data: {"taskId": "uuid", "status": "completed", "executionTime": 5000}
```

---

### POST /tasks/:taskId/cancel - 取消任务

**响应**：
```typescript
{
  code: 0,
  message: "Task cancelled successfully"
}
```

---

### POST /tasks/:taskId/retry - 重试任务

**响应**：
```typescript
{
  code: 0,
  data: {
    taskId: string;
    status: 'pending';
  }
}
```

---

### GET /tasks/:taskId/result - 获取任务结果

**响应**：
```typescript
{
  code: 0,
  data: {
    testCode: string;
    testFile: string;
    coverage: object;
    execution: object;
    exportedFiles: string[];
    report: string;            // Markdown 报告
  }
}
```

---

### ⚠️ GET /tasks/:taskId/export - 导出任务结果（设计稿，未实现，产物经 GET /sessions/:id/output-files 获取）

**查询参数**：
```typescript
{
  format?: 'zip' | 'tar';
  includeReport?: boolean;
  includeLogs?: boolean;
}
```

**响应**：文件下载

---

## ⚠️ 语言接口 (Languages)（设计稿，整组未实现，语言列表由前端静态维护）

### GET /languages - 获取支持的语言列表

**响应**：
```typescript
{
  code: 0,
  data: [{
    id: string;                // python, java, cpp
    name: string;              // Python, Java, C++
    extensions: string[];      // [".py"]
    frameworks: string[];      // ["pytest"]
    features: {
      parse: boolean;
      execute: boolean;
      coverage: boolean;
      export: boolean;
    }
  }]
}
```

---

### GET /languages/:id/frameworks - 获取语言框架

**响应**：
```typescript
{
  code: 0,
  data: [{
    id: string;
    name: string;
    version: string;
    features: string[];
  }]
}
```

---

## ⚠️ 管理员接口 (Admin)（设计稿，整组未实现）

### GET /admin/users - 获取用户列表

**权限**：admin

**查询参数**：
```typescript
{
  page?: number;
  pageSize?: number;
  role?: string;
  status?: string;
  search?: string;
}
```

---

### GET /admin/users/:id - 获取用户详情

---

### PUT /admin/users/:id - 更新用户

**请求**：
```typescript
{
  role?: string;
  status?: string;
}
```

---

### DELETE /admin/users/:id - 删除用户

---

### GET /admin/stats - 获取系统统计

**响应**：
```typescript
{
  code: 0,
  data: {
    users: {
      total: number;
      active: number;
      newToday: number;
    },
    tasks: {
      total: number;
      running: number;
      completedToday: number;
      failedToday: number;
    },
    apiKeys: {
      total: number;
      active: number;
    },
    storage: {
      totalFiles: number;
      totalSize: number;
    },
    tokens: {
      totalUsed: number;
      usedToday: number;
    }
  }
}
```

---

### GET /admin/stats/daily - 获取每日统计

**查询参数**：
```typescript
{
  startDate: string;
  endDate: string;
}
```

---

## 🔒 认证方式

### Bearer Token

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### API Key

```http
X-API-Key: tg_abc123_xK9mN2pL5qR8sT1vW3yZ
```

### 混合认证

优先使用 API Key，其次使用 Bearer Token。

---

## 📊 错误码汇总

| 错误码 | 说明 |
|--------|------|
| 0 | 成功 |
| 1001 | 认证失败 |
| 1002 | Token 过期 |
| 1003 | Token 无效 |
| 1004 | 用户不存在 |
| 1005 | 邮箱已存在 |
| 1006 | 用户名已存在 |
| 1007 | 密码强度不足 |
| 2001 | API Key 不存在 |
| 2002 | API Key 已过期 |
| 2003 | API Key 无效 |
| 2004 | API Key 限流 |
| 3001 | 任务不存在 |
| 3002 | 任务正在运行 |
| 3003 | 任务已取消 |
| 4001 | 路径不存在 |
| 4002 | 路径无权限 |
| 4003 | 名称已存在 |
| 5001 | 文件不存在 |
| 5002 | 文件过大 |
| 5003 | 文件类型不支持 |
| 9001 | 系统内部错误 |
| 9002 | 数据库错误 |

---

*文档版本: 1.0*
*创建时间: 2026-06-04*
