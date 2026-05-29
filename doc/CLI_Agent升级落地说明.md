# CLI Agent 升级落地说明

## 当前结论

项目已经从“Python 专用 workflow + 其他语言分支”收敛为“统一 workflow + 语言适配器”结构。

Python、Java、C++ 都走同一个 `generate-test-workflow`：

```text
读取源码
→ 识别语言
→ adapter 解析源码
→ 生成测试用例
→ 导出用例草稿
→ 生成测试代码
→ 执行测试
→ 质量检查
→ 失败诊断
→ 自愈重试
→ 最终导出
```

workflow 不再把 Python 当成特权路径，也没有“Python 完整执行，其他语言只导出骨架”的分支。

## 目录结构

```text
src/
  cli.ts
  mastra/
    index.ts
    workflows/
      generate-test-workflow.ts
    languages/
      types.ts
      registry.ts
      python-adapter.ts
      java-adapter.ts
      cpp-adapter.ts
    agents/
      cli-conversation-agent.ts
      test-case-agent.ts
      test-code-agent.ts
      diagnosis-agent.ts
    runtime/
      python-bridge.ts
      command-runner.ts
    memory/
      in-memory-store.ts
      session-state.ts
    tools/
      parse-source-code-tool.ts
      execute-tests-tool.ts
      export-cases-tool.ts
      check-quality-tool.ts
      read-file-tool.ts
python-runtime/
  parse_source.py
  run_pytest.py
  export_cases.py
```

### 关键职责

- `src/cli.ts`：自然语言交互入口，负责把用户输入交给对话 Agent，并执行已确认的结构化计划。
- `cli-conversation-agent.ts`：真正理解命令行用户意图的对话 Agent，负责回答问题、主动追问缺失信息、提出计划。
- `generate-test-workflow.ts`：唯一主 workflow，所有语言都走这条链路。
- `languages/types.ts`：统一数据结构，包括源码分析、执行结果、质量结果、诊断结果、版本记录。
- `languages/registry.ts`：根据语言或文件扩展名选择 adapter。
- `python-adapter.ts`：Python 的解析、pytest 执行、质量检查、诊断、导出。
- `java-adapter.ts`：Java 的解析、JUnit 5 测试生成、Maven 执行、质量检查、诊断、导出。
- `cpp-adapter.ts`：C++ 的解析、GoogleTest 测试生成、g++/GoogleTest 执行、质量检查、诊断、导出。
- `runtime/command-runner.ts`：需要用户确认的命令执行器，会打开可见 PowerShell 窗口。
- `memory/`：进程内会话记忆。

## 自然语言 CLI

交互模式：

```bash
npm run generate -- --interactive
```

示例：

```text
用户：你是谁
Agent：我是命令行里的测试用例生成 Agent...
用户：帮我给 D:\project\calculator.py 生成测试
Agent：我会先理解需求；如果缺少输出目录、自愈轮次或测试预期，会主动追问。信息足够后，我会提出执行计划并等待确认。
用户：继续
Agent：开始执行...
Agent：测试失败，我判断是依赖缺失，建议执行 python -m pip install pytest，是否执行？
用户：确认
Agent：打开新的 PowerShell 窗口执行命令...
```

## 验收标准对应关系

| 验收项 | 当前状态 |
|---|---|
| Python、Java、C++ 都走同一个 workflow | 已完成 |
| workflow 没有 Python 特权分支 | 已完成 |
| 三种语言都能导出测试代码和报告 | 已完成 |
| 三种语言都有执行结果 | 已完成 |
| 三种语言都有质量检查 | 已完成 |
| 三种语言都有失败诊断 | 已完成 |
| 三种语言都有自愈版本记录 | 已完成 |
| CLI 可以自然语言交互并在关键动作前确认 | 已完成 |

## 验证命令

```bash
npm run build

node dist\cli.js --help
```

说明：`TESTGENERATE_LLM='off'` 是离线冒烟测试用的开关。正常使用时不要设置，CLI 会优先调用 `cli-conversation-agent` 理解用户意图；只有模型不可用时才退回本地兜底逻辑。

三语言冒烟测试可以使用任意 `.py`、`.java`、`.cpp` 源文件执行：

```bash
$env:TESTGENERATE_LLM='off'
node dist\cli.js --input <your-file.py> --output output\smoke-python --language python --max-attempts 1
node dist\cli.js --input <your-file.java> --output output\smoke-java --language java --max-attempts 1
node dist\cli.js --input <your-file.cpp> --output output\smoke-cpp --language cpp --max-attempts 1
```
