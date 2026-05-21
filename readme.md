testgenerate-agent/  
│  
├── 📦 package.json              ← Node.js 依赖配置  
├── 📜 tsconfig.json             ← TypeScript 配置  
├── 🔐 .env                      ← LLM API Key 配置  
│  
├── 📂 src/mastra/               ← 🟦【Mastra 核心代码】  
│   ├── 📄 index.ts              ←   入口：注册所有 Agent 和 Workflow  
│   │  
│   ├── 📂 agents/               ← 🧠【Agent 定义】  
│   │   ├── test-case-agent.ts   ←   测试用例生成专家  
│   │   ├── test-code-agent.ts   ←   测试代码生成专家  
│   │   └── diagnosis-agent.ts   ←   失败诊断专家  
│   │  
│   ├── 📂 workflows/            ← 🔄【Workflow 编排】  
│   │   └── generate-test-workflow.ts  ← 主流程：解析→生成→执行→导出  
│   │  
│   ├── 📂 tools/                ← 🛠️【工具定义】  
│   │   ├── read-file-tool.ts         ← 读取源文件   
│   │   ├── parse-source-code-tool.ts ← AST 解析  
│   │   ├── execute-tests-tool.ts     ← 执行 pytest  
│   │   └── export-cases-tool.ts      ← 导出结果  
│   │  
│   └── 📂 runtime/              ← 🔗【Python 桥接】  
│       └── python-bridge.ts     ←   TypeScript 调 Python 胶水层  
│  
├── 📂 python-runtime/           ← 🟩【Python 运行时】  
│   ├── parse_source.py          ←   AST 代码解析  
│   ├── run_pytest.py            ←   pytest 执行器  
│   ├── export_cases.py          ←   导出器  
│   └── requirements.txt         ←   Python 依赖  
│  
└── 📂 output/                   ← 📤【输出目录】  
    ├── sources/  
    ├── tests/  
    ├── reports/  
    └── exports/  
 




###  Studio（可视化调试台）
Mastra 最爽的功能——启动后打开 http://localhost:4111 ，在浏览器里：

- 🧪 给 Agent 发消息，看它怎么思考、调了哪些工具
- 🔄 运行 Workflow，看每一步的输入输出
- 📊 查看调用链和 Token 消耗
## 🚀 跑起来！3 步上手
### 第 1 步：配 API Key
编辑 .env ：
```
OPENAI_API_KEY=sk-你的Key
```
### 第 2 步：启动 Dev Server
```
cd D:\deepseekV4-workspace\testgenerate-agent
npx mastra dev
``` 
启动后在浏览器打开 http://localhost:4111 → 进入 Mastra Studio 🎉

### 本地 CLI 运行
如果只想直接跑完整生成流程，可以先构建，再执行：

```
npm run build
npm run generate -- .\testdata\sample.py .\output\cli-smoke 1
```

输出只包含两类导出文件：

- `.py`：pytest 测试代码
- `.md`：测试用例、执行摘要和诊断说明


### 第 3 步：在 Studio 里测试
测试 Agent：

1. 左侧选 test-case-agent
2. 输入框里粘一段 Python 代码
3. 看 Agent 怎么调用 parseSourceCodeTool 解析代码
运行 Workflow：

1. 点 Workflows 标签页 → generate-test-workflow
2. 输入你的 file_path （比如 ./testdata/example.py ）
3. 点 Run → 实时观察每一步的执行状态！    
