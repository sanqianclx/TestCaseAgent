-- =====================================================
-- TestGenerate Agent 数据库初始化脚本
-- 数据库: MySQL 8.0+
-- 字符集: utf8mb4
-- =====================================================

-- 创建数据库
CREATE DATABASE IF NOT EXISTS testgenerate
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE testgenerate;

-- =====================================================
-- 1. 用户表 (users)
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '用户 ID',
  username        VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
  email           VARCHAR(100) NOT NULL UNIQUE COMMENT '邮箱',
  password_hash   VARCHAR(255) NOT NULL COMMENT '密码哈希',
  avatar_url      VARCHAR(500) DEFAULT NULL COMMENT '头像 URL',
  role            ENUM('user', 'admin', 'super_admin') DEFAULT 'user' COMMENT '角色',
  status          ENUM('active', 'inactive', 'banned') DEFAULT 'active' COMMENT '状态',
  email_verified  BOOLEAN DEFAULT FALSE COMMENT '邮箱是否验证',
  preferences     JSON DEFAULT NULL COMMENT '用户偏好设置',
  last_login_at   DATETIME DEFAULT NULL COMMENT '最后登录时间',
  last_login_ip   VARCHAR(45) DEFAULT NULL COMMENT '最后登录 IP',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

  INDEX idx_email (email),
  INDEX idx_username (username),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- =====================================================
-- 2. API Key 表 (api_keys)
-- =====================================================
CREATE TABLE IF NOT EXISTS api_keys (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT 'API Key ID',
  user_id         BIGINT NOT NULL COMMENT '用户 ID',
  name            VARCHAR(100) NOT NULL COMMENT 'Key 名称',
  key_hash        VARCHAR(255) NOT NULL COMMENT 'Key 哈希',
  prefix          VARCHAR(10) NOT NULL COMMENT 'Key 前缀',
  permissions     JSON DEFAULT ('["read", "generate"]') COMMENT '权限列表',
  rate_limit      INT DEFAULT 100 COMMENT '每小时请求限制',
  expires_at      DATETIME DEFAULT NULL COMMENT '过期时间',
  last_used_at    DATETIME DEFAULT NULL COMMENT '最后使用时间',
  last_used_ip    VARCHAR(45) DEFAULT NULL COMMENT '最后使用 IP',
  usage_count     BIGINT DEFAULT 0 COMMENT '使用次数',
  is_active       BOOLEAN DEFAULT TRUE COMMENT '是否启用',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_prefix (prefix),
  INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='API Key 表';

-- =====================================================
-- 3. 工作空间表 (workspaces)
-- =====================================================
CREATE TABLE IF NOT EXISTS workspaces (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '工作空间 ID',
  user_id         BIGINT NOT NULL COMMENT '用户 ID',
  name            VARCHAR(100) NOT NULL COMMENT '工作空间名称',
  base_path       VARCHAR(500) NOT NULL COMMENT '工作目录绝对路径',
  description     TEXT DEFAULT NULL COMMENT '描述',
  is_default      BOOLEAN DEFAULT FALSE COMMENT '是否默认工作空间',
  settings        JSON DEFAULT NULL COMMENT '工作空间配置',
  last_accessed_at DATETIME DEFAULT NULL COMMENT '最后访问时间',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  UNIQUE KEY uk_user_name (user_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作空间表';

-- =====================================================
-- 4. 会话表 (sessions)
-- =====================================================
CREATE TABLE IF NOT EXISTS sessions (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '会话 ID',
  user_id         BIGINT NOT NULL COMMENT '用户 ID',
  workspace_id    BIGINT DEFAULT NULL COMMENT '工作空间 ID',
  title           VARCHAR(200) DEFAULT '新会话' COMMENT '会话标题',
  status          ENUM('active', 'archived', 'deleted') DEFAULT 'active' COMMENT '状态',
  context         JSON DEFAULT NULL COMMENT '会话上下文',
  model_config    JSON DEFAULT NULL COMMENT '模型配置',
  message_count   INT DEFAULT 0 COMMENT '消息数量',
  total_tokens    BIGINT DEFAULT 0 COMMENT '总 Token 数',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  last_message_at DATETIME DEFAULT NULL COMMENT '最后消息时间',

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_workspace_id (workspace_id),
  INDEX idx_status (status),
  INDEX idx_last_message_at (last_message_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会话表';

-- =====================================================
-- 5. 消息表 (messages)
-- =====================================================
CREATE TABLE IF NOT EXISTS messages (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '消息 ID',
  session_id      BIGINT NOT NULL COMMENT '会话 ID',
  role            ENUM('user', 'assistant', 'system', 'tool') NOT NULL COMMENT '角色',
  content         TEXT NOT NULL COMMENT '消息内容',
  message_type    ENUM('text', 'code', 'file', 'error', 'task_result') DEFAULT 'text' COMMENT '消息类型',
  metadata        JSON DEFAULT NULL COMMENT '消息元数据',
  token_usage     JSON DEFAULT NULL COMMENT 'Token 使用统计',
  parent_id       BIGINT DEFAULT NULL COMMENT '父消息 ID',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  INDEX idx_session_id (session_id),
  INDEX idx_role (role),
  INDEX idx_created_at (created_at),
  INDEX idx_parent_id (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='消息表';

-- =====================================================
-- 6. 任务表 (tasks)
-- =====================================================
CREATE TABLE IF NOT EXISTS tasks (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '任务 ID',
  user_id         BIGINT NOT NULL COMMENT '用户 ID',
  workspace_id    BIGINT DEFAULT NULL COMMENT '工作空间 ID',
  session_id      BIGINT DEFAULT NULL COMMENT '会话 ID',
  api_key_id      BIGINT DEFAULT NULL COMMENT 'API Key ID',
  task_id         VARCHAR(36) NOT NULL UNIQUE COMMENT 'UUID',
  status          ENUM('pending', 'running', 'completed', 'failed', 'cancelled') DEFAULT 'pending' COMMENT '状态',
  mode            ENUM('workflow', 'autonomous') DEFAULT 'workflow' COMMENT '模式',
  source_file     VARCHAR(500) NOT NULL COMMENT '源文件路径',
  source_content  TEXT DEFAULT NULL COMMENT '源代码快照',
  language        VARCHAR(20) NOT NULL COMMENT '编程语言',
  requirements    TEXT DEFAULT NULL COMMENT '需求描述',
  output_dir      VARCHAR(500) DEFAULT NULL COMMENT '输出目录',
  result          JSON DEFAULT NULL COMMENT '执行结果',
  error_message   TEXT DEFAULT NULL COMMENT '错误信息',
  execution_time  INT DEFAULT NULL COMMENT '执行耗时(毫秒)',
  token_usage     JSON DEFAULT NULL COMMENT 'Token 使用统计',
  attempt_count   INT DEFAULT 0 COMMENT '尝试次数',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  started_at      DATETIME DEFAULT NULL COMMENT '开始时间',
  completed_at    DATETIME DEFAULT NULL COMMENT '完成时间',

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_workspace_id (workspace_id),
  INDEX idx_session_id (session_id),
  INDEX idx_task_id (task_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务表';

-- =====================================================
-- 7. 任务日志表 (task_logs)
-- =====================================================
CREATE TABLE IF NOT EXISTS task_logs (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '日志 ID',
  task_id         VARCHAR(36) NOT NULL COMMENT '任务 UUID',
  session_id      BIGINT DEFAULT NULL COMMENT '会话 ID',
  level           ENUM('info', 'warn', 'error', 'debug', 'step') DEFAULT 'info' COMMENT '日志级别',
  step            VARCHAR(50) DEFAULT NULL COMMENT '当前步骤',
  message         TEXT NOT NULL COMMENT '日志消息',
  metadata        JSON DEFAULT NULL COMMENT '元数据',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

  INDEX idx_task_id (task_id),
  INDEX idx_session_id (session_id),
  INDEX idx_level (level),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务日志表';

-- =====================================================
-- 8. 上传文件表 (uploaded_files)
-- =====================================================
CREATE TABLE IF NOT EXISTS uploaded_files (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '文件 ID',
  user_id         BIGINT NOT NULL COMMENT '用户 ID',
  workspace_id    BIGINT DEFAULT NULL COMMENT '工作空间 ID',
  session_id      BIGINT DEFAULT NULL COMMENT '会话 ID',
  filename        VARCHAR(255) NOT NULL COMMENT '存储文件名',
  original_name   VARCHAR(255) NOT NULL COMMENT '原始文件名',
  mime_type       VARCHAR(100) NOT NULL COMMENT 'MIME 类型',
  size            BIGINT NOT NULL COMMENT '文件大小(字节)',
  path            VARCHAR(500) NOT NULL COMMENT '存储路径',
  hash            VARCHAR(64) NOT NULL COMMENT '文件 SHA256',
  purpose         ENUM('source', 'reference', 'config', 'other') DEFAULT 'source' COMMENT '用途',
  metadata        JSON DEFAULT NULL COMMENT '文件元数据',
  is_processed    BOOLEAN DEFAULT FALSE COMMENT '是否已处理',
  processed_at    DATETIME DEFAULT NULL COMMENT '处理时间',
  expires_at      DATETIME DEFAULT NULL COMMENT '过期时间',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_workspace_id (workspace_id),
  INDEX idx_session_id (session_id),
  INDEX idx_hash (hash),
  INDEX idx_purpose (purpose),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='上传文件表';

-- =====================================================
-- 9. 文件内容表 (file_contents)
-- =====================================================
CREATE TABLE IF NOT EXISTS file_contents (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '内容 ID',
  file_id         BIGINT NOT NULL COMMENT '文件 ID',
  chunk_index     INT NOT NULL DEFAULT 0 COMMENT '分块索引',
  content         LONGBLOB NOT NULL COMMENT '文件内容',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

  FOREIGN KEY (file_id) REFERENCES uploaded_files(id) ON DELETE CASCADE,
  UNIQUE KEY uk_file_chunk (file_id, chunk_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件内容表';

-- =====================================================
-- 10. 使用统计表 (usage_stats)
-- =====================================================
CREATE TABLE IF NOT EXISTS usage_stats (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '统计 ID',
  user_id         BIGINT NOT NULL COMMENT '用户 ID',
  date            DATE NOT NULL COMMENT '日期',
  task_count      INT DEFAULT 0 COMMENT '任务数',
  message_count   INT DEFAULT 0 COMMENT '消息数',
  token_usage     BIGINT DEFAULT 0 COMMENT 'Token 使用量',
  file_count      INT DEFAULT 0 COMMENT '文件数',
  storage_used    BIGINT DEFAULT 0 COMMENT '存储使用量(字节)',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uk_user_date (user_id, date),
  INDEX idx_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='使用统计表';

-- =====================================================
-- 创建复合索引（优化查询性能）
-- =====================================================

-- 会话查询优化
CREATE INDEX idx_sessions_user_status ON sessions(user_id, status, last_message_at DESC);

-- 消息查询优化
CREATE INDEX idx_messages_session_created ON messages(session_id, created_at);

-- 任务查询优化
CREATE INDEX idx_tasks_user_status ON tasks(user_id, status, created_at DESC);

-- 文件查询优化
CREATE INDEX idx_files_user_purpose ON uploaded_files(user_id, purpose, created_at DESC);

-- =====================================================
-- 插入默认管理员用户
-- 密码: admin123 (bcrypt 哈希)
-- =====================================================
INSERT INTO users (username, email, password_hash, role, status, email_verified)
VALUES (
  'admin',
  'admin@testgenerate.com',
  '$2a$10$rQZ8K.5X2b2qJ3qQ5qQ5qOeQ5qQ5qQ5qQ5qQ5qQ5qQ5qQ5qQ5q',
  'admin',
  'active',
  TRUE
) ON DUPLICATE KEY UPDATE id=id;

-- =====================================================
-- 完成！
-- =====================================================
SELECT '✅ 数据库初始化完成！' AS message;
SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = 'testgenerate';
