# 数据库配置文档

## 📊 数据库信息

| 配置项 | 值 |
|--------|-----|
| **数据库名** | testgenerate |
| **字符集** | utf8mb4 |
| **排序规则** | utf8mb4_unicode_ci |
| **MySQL 版本** | 8.4.4 |
| **存储引擎** | InnoDB |

---

## 🔗 连接配置

### 环境变量 (.env)

```env
# 数据库配置
DATABASE_URL="mysql://root:123456@localhost:3306/testgenerate"
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=123456
DB_NAME=testgenerate
```

### Prisma 配置

```prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}
```

---

## 📋 表结构概览

### 核心表 (10 张)

| 表名 | 用途 | 记录数 |
|------|------|--------|
| `users` | 用户表 | 0 |
| `api_keys` | API Key 表 | 0 |
| `workspaces` | 工作空间表 | 0 |
| `sessions` | 会话表 | 0 |
| `messages` | 消息表 | 0 |
| `tasks` | 任务表 | 0 |
| `task_logs` | 任务日志表 | 0 |
| `uploaded_files` | 上传文件表 | 0 |
| `file_contents` | 文件内容表 | 0 |
| `usage_stats` | 使用统计表 | 0 |

---

## 🔑 索引策略

### 主要索引

- **主键索引**: 每张表的 `id` 字段
- **唯一索引**: `users.username`, `users.email`, `tasks.task_id`
- **外键索引**: 所有关联字段
- **复合索引**: 优化常用查询

### 复合索引列表

```sql
-- 会话查询优化
idx_sessions_user_status (user_id, status, last_message_at DESC)

-- 消息查询优化
idx_messages_session_created (session_id, created_at)

-- 任务查询优化
idx_tasks_user_status (user_id, status, created_at DESC)

-- 文件查询优化
idx_files_user_purpose (user_id, purpose, created_at DESC)
```

---

## 📈 数据量预估

| 表 | 单行大小 | 日增长量 | 月增长量 |
|----|----------|----------|----------|
| users | ~1 KB | 100 | 3,000 |
| api_keys | ~0.5 KB | 50 | 1,500 |
| workspaces | ~1 KB | 50 | 1,500 |
| sessions | ~2 KB | 500 | 15,000 |
| messages | ~5 KB | 5,000 | 150,000 |
| tasks | ~10 KB | 200 | 6,000 |
| task_logs | ~2 KB | 2,000 | 60,000 |
| uploaded_files | ~1 KB | 300 | 9,000 |

---

## 🛠️ 常用 SQL 命令

### 查看表结构

```sql
-- 查看所有表
USE testgenerate;
SHOW TABLES;

-- 查看表结构
DESCRIBE users;
DESCRIBE api_keys;
DESCRIBE workspaces;
DESCRIBE sessions;
DESCRIBE messages;
DESCRIBE tasks;
```

### 查询数据

```sql
-- 查看用户列表
SELECT id, username, email, role, status, created_at FROM users;

-- 查看会话列表
SELECT s.id, s.title, s.status, u.username, s.created_at
FROM sessions s
JOIN users u ON s.user_id = u.id
ORDER BY s.created_at DESC
LIMIT 10;

-- 查看任务统计
SELECT status, COUNT(*) as count
FROM tasks
GROUP BY status;
```

### 维护命令

```sql
-- 优化表
OPTIMIZE TABLE users, api_keys, sessions, messages, tasks;

-- 分析表
ANALYZE TABLE users, api_keys, sessions, messages, tasks;

-- 检查表
CHECK TABLE users, api_keys, sessions, messages, tasks;
```

---

## 🔒 安全配置

### 用户权限

```sql
-- 创建应用用户
CREATE USER 'tg_app'@'localhost' IDENTIFIED BY 'your_password';
GRANT SELECT, INSERT, UPDATE, DELETE ON testgenerate.* TO 'tg_app'@'localhost';

-- 创建只读用户
CREATE USER 'tg_readonly'@'localhost' IDENTIFIED BY 'your_password';
GRANT SELECT ON testgenerate.* TO 'tg_readonly'@'localhost';

-- 刷新权限
FLUSH PRIVILEGES;
```

---

## 📝 更新日志

| 日期 | 版本 | 更新内容 |
|------|------|----------|
| 2026-06-04 | v1.0 | 初始创建，10 张表 |

---

*文档版本: 1.0*
*创建时间: 2026-06-04*
*MySQL 版本: 8.4.4*
