# 后端服务器配置指南

## 🚀 快速开始

### 1. 环境准备

确保已安装以下软件：
- Node.js 18+
- MySQL 8.0+
- npm 或 yarn

### 2. 数据库初始化

```bash
# 登录 MySQL
mysql -u root -p123456

# 执行初始化脚本
source docs/init-database.sql
```

### 3. 安装依赖

```bash
npm install
```

### 4. 生成 Prisma Client

```bash
npm run prisma:generate
```

### 5. 启动服务器

```bash
# 开发模式（热重载）
npm run server:dev

# 生产模式
npm run build
npm run server
```

---

## 📡 API 端点

服务器启动后，访问 http://localhost:3000/api/v1/health 检查服务状态。

### 认证接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/v1/auth/register | 用户注册 |
| POST | /api/v1/auth/login | 用户登录 |
| POST | /api/v1/auth/refresh | 刷新 Token |
| POST | /api/v1/auth/logout | 用户登出 |
| GET | /api/v1/auth/me | 获取当前用户 |
| PUT | /api/v1/auth/profile | 更新个人资料 |
| PUT | /api/v1/auth/password | 修改密码 |

### API Key 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/api-keys | 获取列表 |
| POST | /api/v1/api-keys | 创建 Key |
| GET | /api/v1/api-keys/stats | 使用统计 |
| GET | /api/v1/api-keys/:id | 获取详情 |
| PUT | /api/v1/api-keys/:id | 更新 Key |
| DELETE | /api/v1/api-keys/:id | 删除 Key |
| POST | /api/v1/api-keys/:id/regenerate | 重新生成 |

### 工作空间接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/workspaces | 获取列表 |
| POST | /api/v1/workspaces | 创建工作空间 |
| GET | /api/v1/workspaces/:id | 获取详情 |
| PUT | /api/v1/workspaces/:id | 更新工作空间 |
| DELETE | /api/v1/workspaces/:id | 删除工作空间 |
| POST | /api/v1/workspaces/:id/validate | 验证目录 |
| GET | /api/v1/workspaces/:id/files | 浏览文件 |

### 会话接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/sessions | 获取列表 |
| POST | /api/v1/sessions | 创建会话 |
| GET | /api/v1/sessions/stats | 会话统计 |
| GET | /api/v1/sessions/:id | 获取详情 |
| PUT | /api/v1/sessions/:id | 更新会话 |
| DELETE | /api/v1/sessions/:id | 删除会话 |
| POST | /api/v1/sessions/:id/archive | 归档会话 |
| GET | /api/v1/sessions/:id/messages | 获取消息 |
| POST | /api/v1/sessions/:id/messages | 发送消息 |

### 文件接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/files | 获取列表 |
| POST | /api/v1/files/upload | 上传文件 |
| POST | /api/v1/files/upload-multiple | 批量上传 |
| GET | /api/v1/files/stats | 文件统计 |
| GET | /api/v1/files/:id | 获取详情 |
| GET | /api/v1/files/:id/content | 获取内容 |
| DELETE | /api/v1/files/:id | 删除文件 |
| POST | /api/v1/files/:id/analyze | 分析文件 |

### 任务接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/tasks | 获取列表 |
| POST | /api/v1/tasks | 创建任务 |
| GET | /api/v1/tasks/stats | 任务统计 |
| GET | /api/v1/tasks/:taskId | 获取详情 |
| GET | /api/v1/tasks/:taskId/logs | 获取日志 |
| POST | /api/v1/tasks/:taskId/cancel | 取消任务 |
| POST | /api/v1/tasks/:taskId/retry | 重试任务 |
| GET | /api/v1/tasks/:taskId/result | 获取结果 |

---

## 🔐 认证方式

### Bearer Token

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/v1/auth/me
```

### API Key

```bash
curl -H "X-API-Key: tg_xxx_xxx" http://localhost:3000/api/v1/tasks
```

---

## 📝 请求示例

### 用户注册

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "Test1234"
  }'
```

### 用户登录

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test1234"
  }'
```

### 创建 API Key

```bash
curl -X POST http://localhost:3000/api/v1/api-keys \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My API Key",
    "permissions": ["read", "generate"]
  }'
```

### 创建工作空间

```bash
curl -X POST http://localhost:3000/api/v1/workspaces \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Project",
    "basePath": "/path/to/project",
    "description": "My project workspace"
  }'
```

### 上传文件

```bash
curl -X POST http://localhost:3000/api/v1/files/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@example.py" \
  -F "purpose=source"
```

---

## ⚙️ 配置说明

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| DATABASE_URL | mysql://root:123456@localhost:3306/testgenerate | 数据库连接 |
| JWT_SECRET | testgenerate-jwt-secret-key-2026 | JWT 密钥 |
| JWT_EXPIRES_IN | 2h | Token 过期时间 |
| JWT_REFRESH_EXPIRES_IN | 7d | Refresh Token 过期时间 |
| PORT | 3000 | 服务器端口 |
| HOST | 0.0.0.0 | 服务器主机 |
| NODE_ENV | development | 运行环境 |
| CORS_ORIGIN | http://localhost:5173 | 允许的跨域来源 |
| UPLOAD_DIR | ./uploads | 文件上传目录 |
| MAX_FILE_SIZE | 10485760 | 最大文件大小 (10MB) |

---

## 🔧 开发工具

### Prisma Studio

可视化数据库管理工具：

```bash
npm run prisma:studio
```

访问 http://localhost:5555 查看数据库。

### 数据库迁移

```bash
# 创建迁移
npm run prisma:migrate

# 推送 schema
npm run prisma:push
```

---

## 🐛 常见问题

### 1. 数据库连接失败

检查 MySQL 服务是否启动，用户名密码是否正确。

### 2. 端口被占用

修改 .env 中的 PORT 配置。

### 3. 文件上传失败

检查上传目录权限和 MAX_FILE_SIZE 配置。

---

*文档版本: 1.0*
*创建时间: 2026-06-04*
