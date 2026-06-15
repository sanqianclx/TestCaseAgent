# TestGenerate Agent

> 基于 Mastra + LLM 的多语言智能测试生成 Agent —— 从源代码输入到可执行测试代码输出的全自动闭环，支持 Python、Java、C++ 三语一体。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)](https://www.typescriptlang.org/)
[![Mastra](https://img.shields.io/badge/Mastra-1.0-purple)](https://mastra.ai/)
[![Python](https://img.shields.io/badge/Python-3.10+-yellow)](https://www.python.org/)
[![Java](https://img.shields.io/badge/Java-17+-orange)](https://www.java.com/)
[![C++](https://img.shields.io/badge/C%2B%2B-17+-brightgreen)](https://isocpp.org/)

***

## 项目简介

**TestGenerate Agent** 是一个具备自主决策能力的多语言智能体，核心能力：

- 🧠 **自主规划**：Agent 根据输入源代码自行判断工作路径，支持自然语言交互
- 🌐 **多语言支持**：Python（pytest）、Java（JUnit 5）、C++（GoogleTest）一行切换
- 🛠️ **工具调用**：LLM 做决策，工具做执行（AST 解析、测试执行、质量检查、结果导出）
- 🔄 **自愈循环**：测试失败时自动诊断根因 → 修正测试代码 → 重新执行，最多可配置 20 次自愈
- 📤 **一键导出**：生成可执行测试代码 + 结构化 Markdown 测试报告（含覆盖率、版本历史、诊断详情）
- 💬 **自然语言交互**：CLI 交互模式，像聊天一样生成测试

***

## 核心工作流

```mermaid
flowchart LR
    A[输入源文件] --> B{语言检测}
    B -->|Python| C1[pytest 适配器]
    B -->|Java| C2[JUnit 5 适配器]
    B -->|C++| C3[GoogleTest 适配器]
    C1 --> D[AST 代码解析]
    C2 --> D
    C3 --> D
    D --> E[LLM 生成测试用例]
    E --> F[导出测试计划]
    F --> G[LLM 生成测试代码]
    G --> H[沙箱执行测试]
    H --> I{通过?}
    I -->|是| J[质量检查]
    J --> K{质量合格?}
    K -->|是| L[导出最终产物]
    K -->|否| M[AI 诊断]
    I -->|否| M
    M --> N{测试代码错误?}
    N -->|是| G
    N -->|否| O[报告用户]
```

***

## 技术栈

|     层次    | 技术                                          | 说明                                                                                   |
| :-------: | :------------------------------------------ | :----------------------------------------------------------------------------------- |
|  Agent 框架 | **Mastra** (TypeScript)                     | Agent 编排、Workflow 调度、工具注册、Studio 可视化调试                                               |
|    LLM    | **DeepSeek**（`@ai-sdk/deepseek`）            | 快慢双通道：`deepseek-v4-flash` 负责首次快速生成，`deepseek-v4-pro` 在自愈重试时保证准确率                     |
|    代码解析   | Python `ast` + **Tree-sitter**              | Python 通过标准库 `ast` 确定性提取；Java/C++ 使用 `tree-sitter-java` / `tree-sitter-cpp` 做 AST 解析 |
|    测试执行   | pytest / Maven (JUnit 5) / g++ (GoogleTest) | 沙箱隔离执行，自动超时保护                                                                        |
|    覆盖率    | coverage.py / JaCoCo                        | 真实行/分支覆盖率测量，失败时降级到符号覆盖率                                                              |
|   Web 后端  | **Express + Prisma + MySQL**                | REST API、JWT 鉴权，管理会话 / 任务 / 文件 / 工作空间                                                |
|   Web 前端  | **React + Vite + Ant Design**               | 仪表盘、对话界面、文件与工作空间管理                                                                   |
| Schema 校验 | Zod                                         | 工具入参出参严格校验                                                                           |
|    内存管理   | 内置 InMemoryStore                            | 会话记忆、上下文摘要、事实存储                                                                      |

***

## Agent 架构

项目采用**多 Agent 协作**架构，在 `src/mastra/agents/` 下定义了 **7 个 Agent**（其中 6 个注册进 Mastra，`diagnosisDecisionAgent` 由工作流内部直接调用），分工明确：

| Agent 文件                    | 导出名                      | 职责                        |  模型通道 |
| :-------------------------- | :----------------------- | :------------------------ | :---: |
| `test-case-agent.ts`        | `testCaseAgent`          | 根据源代码结构设计测试用例（含边界值、异常路径）  | flash |
| `test-code-agent.ts`        | `testCodeAgent`          | 将用例翻译为可执行测试代码（首次生成）       | flash |
| `test-code-agent.ts`        | `testCodeAgentPro`       | 自愈重试时重写测试代码，精度更高          |  pro  |
| `diagnosis-agent.ts`        | `diagnosisAgent`         | 分析测试失败根因，输出自然语言诊断         | flash |
| `diagnosis-agent.ts`        | `diagnosisAgentPro`      | 自愈重试时的高精度诊断               |  pro  |
| `diagnosis-agent.ts`        | `diagnosisDecisionAgent` | 将自然语言诊断转为结构化决策（JSON）      | flash |
| `cli-conversation-agent.ts` | `cliAgent`               | 理解用户自然语言需求、制定执行计划、决定下一步动作 | flash |

> 「快慢双通道」：`flash` 即 `deepseek-v4-flash`（首生成，速度优先），`pro` 即 `deepseek-v4-pro`（自愈重试，准确率优先）。

***

## 项目结构

```
testgenerate-agent/
├── src/
│   ├── cli.ts                          ← CLI 入口（命令行 / 交互 / 自主三种模式）
│   ├── tree-sitter.d.ts                ← Tree-sitter 类型声明
│   ├── autonomous/                     ← 自主 Agent 模式（LLM 自己规划 + 工具调用）
│   │   ├── autonomous-agent.ts            自主 Agent 主体
│   │   ├── autonomous-loop.ts            REPL 多轮对话循环
│   │   ├── approval.ts                   工具调用审批策略
│   │   ├── safety.ts                     命令风险评级
│   │   ├── shell-runner.ts               shell 命令执行
│   │   ├── ask-user-tool.ts              主动向用户提问
│   │   └── types.ts / index.ts
│   ├── mastra/
│   │   ├── index.ts                    ← Mastra 入口：注册 Agent 和 Workflow
│   │   ├── agents/                     ← Agent 定义（7 个，详见上表）
│   │   │   ├── cli-conversation-agent.ts
│   │   │   ├── diagnosis-agent.ts
│   │   │   ├── test-case-agent.ts
│   │   │   └── test-code-agent.ts
│   │   ├── workflows/
│   │   │   └── generate-test-workflow.ts  ← 核心工作流（7 步：解析→用例→导出计划→代码→执行→自愈→导出）
│   │   ├── tools/                      ← Tool 定义（7 个）
│   │   │   ├── read-file-tool.ts          读取源文件
│   │   │   ├── write-file-tool.ts         写文件
│   │   │   ├── parse-source-code-tool.ts  AST 解析（Python ast + Tree-sitter）
│   │   │   ├── execute-tests-tool.ts      执行测试
│   │   │   ├── coverage-tool.ts           真实覆盖率测量
│   │   │   ├── export-cases-tool.ts       导出测试产物
│   │   │   └── logger-tool.ts             日志写入
│   │   ├── languages/                  ← 语言适配器（多语言抽象）
│   │   │   ├── types.ts                   统一类型定义
│   │   │   ├── registry.ts                语言注册与检测
│   │   │   ├── python-adapter.ts          Python + pytest
│   │   │   ├── java-adapter.ts            Java + JUnit 5 + Maven
│   │   │   └── cpp-adapter.ts             C++ + GoogleTest + g++
│   │   ├── runtime/                    ← 运行时基础设施
│   │   │   ├── env.ts                     环境变量与 LLM 连接检查
│   │   │   ├── command-runner.ts          命令风险评级与可见窗口执行
│   │   │   ├── python-bridge.ts           TypeScript → Python 桥接
│   │   │   ├── cli-output.ts              CLI 彩色输出 API（TTY/NO_COLOR 降级）
│   │   │   └── logger.ts                  日志基础设施
│   │   └── memory/                     ← 会话记忆
│   │       ├── in-memory-store.ts          内存存储引擎
│   │       └── session-state.ts            会话状态管理
│   └── server/                         ← Web 后端（Express + Prisma + MySQL）
│       ├── index.ts / app.ts             服务器入口与应用装配
│       ├── config/                       数据库与环境配置
│       ├── controllers/                  auth / session / task / file / workspace / apiKey
│       ├── services/                     业务逻辑 + agent/workflow 执行器 + 流式推送
│       ├── routes/                       REST 路由（含 SSE stream 路由）
│       ├── middleware/                   鉴权 / 校验 / 错误处理
│       └── utils/                        jwt / crypto / 统一响应
├── client/                             ← Web 前端（React + Vite + Ant Design）
│   └── src/                              pages / components / api / stores
├── prisma/
│   └── schema.prisma                   ← 数据库模型定义
├── python-runtime/                     ← Python 运行时脚本
│   ├── parse_source.py                AST 代码解析
│   ├── run_pytest.py                  pytest 执行器（沙箱隔离）
│   ├── coverage_runner.py             coverage.py 覆盖率运行器
│   ├── export_cases.py                测试报告导出器
│   └── requirements.txt               Python 依赖
├── doc/                                ← 设计文档（需求 / 概要 / 详细）
│   ├── 需求分析文档.md
│   ├── 需求规格说明书2.0.md
│   ├── 概要设计文档.md
│   └── 详细设计文档.md
├── docs/                               ← Web 版文档（API / 数据库 / 部署）
│   ├── API接口设计文档.md
│   ├── 数据库设计文档.md
│   ├── 数据库配置说明.md
│   ├── 服务器配置指南.md
│   ├── 实施计划文档.md
│   ├── 项目完成总结.md
│   └── init-database.sql
└── diagrams/
    └── 系统架构图.svg
```

***

## 快速开始

### 1. 环境要求

- **Node.js** >= 22
- **MySQL** >= 8.0
- **Python** >= 3.10，已安装 pytest
- **DeepSeek API Key**（`DEEPSEEK_API_KEY`）
- （可选）Java 17+ + Maven（用于 Java 测试）
- （可选）g++ 支持 C++17（用于 C++ 测试）

### 2. 安装依赖

```bash
# Node 依赖
npm install

# Python 依赖（pytest + coverage.py）
pip install -r python-runtime/requirements.txt
pip install coverage

# 前端依赖
cd client && npm install
```

### 3. 配置环境变量

复制 `.env.example` 为 `.env` 并按需配置（完整项见 `.env.example`）：

```env
# 数据库
DATABASE_URL="mysql://root:123456@localhost:3306/testgenerate"

# LLM（DeepSeek）
DEEPSEEK_API_KEY="your-deepseek-api-key"

# JWT 鉴权
JWT_SECRET="your-super-secret-jwt-key-change-in-production"
JWT_EXPIRES_IN="2h"

# 服务器 / CORS
PORT=3000
CORS_ORIGIN="http://localhost:5173"
```

### 4. 初始化数据库

```bash
# 执行数据库初始化脚本
mysql -u root -p < docs/init-database.sql

# 生成 Prisma Client
npm run prisma:generate
```

### 5. 启动 Web 界面

```bash
# 启动后端 API 服务器
npm run server:dev

# 启动前端开发服务器（新终端）
cd client && npm run dev
```

访问 <http://localhost:5173> 使用 Web 界面。

### 6. CLI 交互模式

```bash
npm run build
npm run generate -- --interactive
```

### 7. CLI 命令行模式

```bash
npm run generate -- --input ./src/example.py --output ./my-tests
```

### 8. 启动 Mastra Studio（可视化调试）

```bash
npx mastra dev
```

浏览器打开 <http://localhost:4111>，可在可视化面板中调试 Agent 和 Workflow。

***

## CLI 选项说明

| 选项                    | 简写   | 说明                                   | 默认值                |
| :-------------------- | :--- | :----------------------------------- | :----------------- |
| `--input`             | `-i` | 源文件路径（支持 .py/.java/.cpp/.cc/.hpp/.h） | -                  |
| `--output`            | `-o` | 输出目录                                 | `./output/exports` |
| `--language`          | `-l` | 语言：python/java/cpp                   | auto（自动检测）         |
| `--max-attempts`      | -    | 最大自愈尝试次数                             | 3                  |
| `--llm-retries`       | -    | 每次 LLM 请求的重试次数                       | 2                  |
| `--requirements`      | -    | 额外需求文本                               | -                  |
| `--requirements-file` | -    | 从文件读取额外需求                            | -                  |
| `--interactive`       | `-I` | 自然语言交互模式                             | 关闭                 |
| `--autonomous` | `--agent` | 自主 Agent REPL 模式（LLM 自己规划 + 工具调用） | 关闭 |
| `--help`              | `-h` | 显示帮助信息                               | -                  |

***

## 自愈机制

Agent 最核心的能力——测试失败后自动修复：

```mermaid
flowchart LR
    A[测试执行] --> B{通过?}
    B -->|是| C[质量检查]
    B -->|否| D[AI 诊断根因]
    C --> E{质量合格?}
    E -->|是| F[导出结果]
    E -->|否| D
    D --> G{测试代码错误?}
    G -->|是| H[重新生成测试代码]
    G -->|否| I[报告用户/请求环境修复]
    H --> A
```

- 每次重试自动切换 Pro 模型（DeepSeek v4-Pro）提高修复成功率
- 所有版本记录自动保存到报告中，方便追溯

***

## Studio 使用指南

Mastra Studio 是开发调试利器：`npx mastra dev`

| 面板            | 功能                             |
| :------------ | :----------------------------- |
| **Agents**    | 直接对话任意 Agent，观察它如何思考、何时调用工具    |
| **Workflows** | 可视化运行 Workflow，实时查看每一步的输入输出和状态 |
| **Traces**    | 查看完整的工具调用链和 Token 消耗           |

### 调试建议

- **测试用例 Agent**：选 `testCaseAgent`，粘贴代码片段，看它如何设计用例
- **诊断 Agent**：选 `diagnosisAgent`，粘贴失败日志，看它如何分析根因
- **运行 Workflow**：选 `generateTestWorkflow`，填写 `file_path` 和 `output_dir`，点 Run

***

## 质量保证体系

测试代码生成后会经过两道把关：

**1. 执行通过性**：在沙箱中真实运行测试，逐用例返回通过 / 失败结果；任一失败即触发自愈循环（见上）。质量结果以 `{ ok, issues[], checked_tests }` 结构在工作流中传递，并写入最终报告。

**2. 覆盖率度量**：

| 维度          | 说明                                        |
| :---------- | :---------------------------------------- |
| 符号覆盖率       | 统计每个函数 / 方法是否被至少一个用例覆盖                    |
| 真实行 / 分支覆盖率 | 通过 coverage.py / JaCoCo 真实测量（失败时降级到符号覆盖率） |

### 覆盖率工具

|   语言   | 工具                                                    |   状态  | 报告路径                            |
| :----: | :---------------------------------------------------- | :---: | :------------------------------ |
| Python | [coverage.py](https://coverage.readthedocs.io/)       | ✅ 已实现 | 临时目录 `coverage.json`            |
|  Java  | [JaCoCo](https://www.jacoco.org/) Maven Plugin 0.8.12 | ✅ 已实现 | `target/site/jacoco/jacoco.xml` |
|   C++  | gcov (Linux) / OpenCppCoverage (Windows)              | 🚧 预留 | 待实现                             |

**统一入口**：`src/mastra/tools/coverage-tool.ts` 暴露 `measureCoverage({test_code, source_code, language, cwd})`，工作流在自愈循环的 4 个节点自动调用。失败时优雅降级到符号覆盖率，并在报告中标注 `coverage_tool` 字段。

**典型报告片段**：

```markdown
## 覆盖率
- 符号覆盖率：100%（已覆盖 8/8 符号）
- 真实行覆盖率：85.5%（工具：coverage.py）
- 已覆盖行数：100/117
- 分支覆盖率：70.0%
```

### CLI 输出与颜色

V2.2 起，CLI 端的彩色输出由 [`src/mastra/runtime/cli-output.ts`](./src/mastra/runtime/cli-output.ts) 提供**显式 API**：

- `logAgent("...")` / `logAgentProgress("...")` — Agent 角色（亮黄加粗）
- `promptUser()` — 用户提示符（亮青加粗）
- `logInfo` / `logWarn` / `logError` / `logSuccess` / `logDebug` — 元数据 / 警告 / 错误 / 成功 / 调试
- `renderProgressBar` / `finishProgressBar` — 进度条辅助

**颜色自动降级**：检测 `NO_COLOR` / `FORCE_COLOR=0` / `CI` / 非 TTY 任一条件即输出无色文本，管道 / 重定向 / CI 环境不会产生 ANSI 乱码。

**对 Studio 友好**：Mastra Studio 进程不调用这些函数，stdout 自然无色，无需特殊配置。

***

## 设计文档

| 文档                                 | 说明                   |
| :--------------------------------- | :------------------- |
| [需求分析文档](./doc/需求分析文档.md)          | 项目背景、功能需求、约束与验收标准    |
| [需求规格说明书 2.0](./doc/需求规格说明书2.0.md) | 详细需求规格               |
| [概要设计文档](./doc/概要设计文档.md)          | 系统架构、模块划分、Agent 运行机制 |
| [详细设计文档](./doc/详细设计文档.md)          | 数据结构、诊断逻辑、版本管理       |
| [API 接口设计文档](./docs/API接口设计文档.md)  | Web 后端 REST API 规格   |
| [数据库设计文档](./docs/数据库设计文档.md)       | 数据表结构与关系（Prisma 模型）  |
| [数据库配置说明](./docs/数据库配置说明.md)       | MySQL 初始化与连接配置       |
| [服务器配置指南](./docs/服务器配置指南.md)       | 后端部署与运行环境            |
| [实施计划文档](./docs/实施计划文档.md)         | Web 版迭代计划            |
| [项目完成总结](./docs/项目完成总结.md)         | Web 版交付总结            |

***

## 版本路线

|    版本    | 目标                                                                   |   状态   |
| :------: | :------------------------------------------------------------------- | :----: |
| **V1.0** | 单文件 Python → AST 解析 → pytest 生成 → 沙箱执行 → 导出                          |  ✅ 已完成 |
| **V2.0** | 失败诊断 + 自愈循环 + 测试代码版本管理 + 质量检查                                        |  ✅ 已完成 |
| **V2.1** | 多语言支持（Java + C++）+ 自然语言 CLI 交互 + 内存记忆                                |  ✅ 已完成 |
| **V2.2** | 真实覆盖率接入（Python coverage.py + Java JaCoCo）+ CLI 输出重构（消除 monkey-patch） |  ✅ 已完成 |
| **V2.3** | C++ 真实覆盖率（gcov / OpenCppCoverage）+ 覆盖率阈值触发自愈                         | 📅 规划中 |
| **V3.0** | Web 面板 + 历史记录 + MySQL 持久化 + 前后端分离                                    |  ✅ 已完成 |
| **V3.1** | 自主 Agent REPL 模式（LLM 自主规划 + 多轮工具调用 + 命令审批）                          |  ✅ 已完成 |

***

## 后续优化

1. C++ 真实覆盖率接入（gcov / OpenCppCoverage）
2. 覆盖率阈值触发自愈（line\_rate < 80% 即触发诊断）
3. 需求文档变更

***

## Web 界面

V3.0 新增完整的 Web 管理界面，支持：

- 📊 **仪表盘** - 统计概览、快速操作
- 💬 **对话界面** - 支持 Agent 和 Workflow 两种模式
- 📁 **文件管理** - 上传源代码文件
- 🗂️ **工作空间** - 管理项目工作目录
- 📋 **会话历史** - 查看历史对话
- ⚡ **任务管理** - 监控任务执行状态
- 🔑 **API Key** - 管理 API 密钥

### 启动 Web 界面

```bash
# 启动后端
npm run server:dev

# 启动前端（新终端）
cd client && npm run dev
```

访问 <http://localhost:5173>

### API 端点

| 模块      | 端点                                 | 说明         |
| ------- | ---------------------------------- | ---------- |
| 认证      | POST /api/v1/auth/register         | 用户注册       |
| 认证      | POST /api/v1/auth/login            | 用户登录       |
| 会话      | GET/POST /api/v1/sessions          | 会话管理       |
| 消息      | POST /api/v1/sessions/:id/messages | 发送消息       |
| 任务      | GET/POST /api/v1/tasks             | 任务管理       |
| 文件      | POST /api/v1/files/upload          | 文件上传       |
| 工作空间    | GET/POST /api/v1/workspaces        | 工作空间管理     |
| API Key | GET/POST /api/v1/api-keys          | API Key 管理 |

***

## 自主 Agent 模式（Autonomous Agent REPL）

与"工作流驱动"模式（`--input` / `--interactive`）并行存在的另一种使用方式：
**LLM 自己规划、自己调用工具**，用户负责在关键步骤上做 y/n 审批。

### 启动

```bash
npm run build       # 编译
npm run agent       # 等价于 node dist/cli.js --autonomous
# 或：node dist/cli.js --autonomous
```

进入后你会看到：

```
Agent：自主测试代码 Agent 已启动。直接告诉我你想做什么。
  - 工具数：9（read/write/parse/execute/coverage/export/logger/shell/ask）
  - 日志文件：.../output/logs/agent.log
  - 当前工作目录：...
  - 输入 exit 退出
User：
```

直接用自然语言告诉 Agent 你想做什么，比如：

- "帮我把 `tests/test_foo.py` 里的断言都改成 `pytest.approx`"
- "看看 `src/utils.py` 第 30 行为什么 `KeyError`，修一下"
- "给 `Calculator.div` 写 3 个 pytest 用例并跑一下"

### 可用工具

| 工具                | 用途                          | 审批策略       |
| ----------------- | --------------------------- | ---------- |
| `readFile`        | 读取任意文本文件                    | 自动放行       |
| `writeFile`       | 写文件（CWD 内自动，外则需确认）          | 路径检查       |
| `parseSourceCode` | AST 解析 Python/Java/C++      | 自动放行       |
| `executeTests`    | 跑 pytest 并返回每个用例结果          | 自动放行       |
| `measureCoverage` | coverage.py / jacoco.xml 解析 | 自动放行       |
| `exportCases`     | 导出测试代码 + 报告                 | 路径检查       |
| `logger`          | 写入 output/logs/agent.log    | 自动放行       |
| `shellRun`        | 同步执行 shell 命令               | 总是走 y/n 审批 |
| `askUser`         | 主动向用户澄清                     | 挂起并展示问题    |

### shell 命令审批

当 Agent 想跑 `shellRun` 时，CLI 会显示：

```
Agent 请求调用工具：shellRun
  参数：command=ls *.py
  风险等级：low
  风险原因：该命令看起来像是普通的检查或测试命令。
  工作目录：D:\...
  允许执行？[y/n/always/never]：User：
```

| 输入                       | 动作                     |
| ------------------------ | ---------------------- |
| `y` / `yes` / `是` / `确认` | 放行一次                   |
| `n` / `no` / `否` / `取消`  | 拒绝一次                   |
| `always` / `auto` / `总是` | 放行 + 记住（本会话内该命令首词自动通过） |
| `never` / `block` / `拒绝` | 拒绝 + 记住（本会话内该命令首词自动拒绝） |

### 与工作流模式的关系

| 维度     | 工作流模式 (`--input` / `--interactive`) | 自主模式 (`--autonomous` / `--agent`) |
| ------ | ----------------------------------- | --------------------------------- |
| LLM 角色 | 流程中的一颗螺丝钉（设计 / 写代码 / 诊断）            | 自主决策大脑                            |
| 执行路径   | 固定 Step 链                           | LLM 多轮工具调用                        |
| 用户角色   | 启动时给参数                              | 持续对话 + 关键步骤审批                     |
| 适用场景   | 一次性"为这个文件生成测试"                      | 反复迭代修改、调试、探索代码                    |
| 记忆     | 一次性会话                               | 进程内持续累积（80 条上限）                   |

**完全独立**：自主模式不引用 `generate-test-workflow` 的任何代码，仅复用日志、CLI 输出、记忆、工具工厂等基础设施。
