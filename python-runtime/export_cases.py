"""
结果导出模块
将测试用例列表、测试代码、执行结果和诊断信息导出为文件。
生成两个文件：(1) test_generated.py 可执行pytest测试文件；
(2) test_cases.md 包含用例表格、执行摘要和诊断信息的Markdown文档。
"""
import json
import os
import sys
from datetime import datetime


def read_input() -> dict:
    """
    读取stdin或命令行参数的JSON输入
    优先从stdin读取（与Node.js spawnSync + input模式兼容），
    若stdin为空则回退到命令行参数。
    """
    raw = sys.stdin.read().strip()
    if not raw and len(sys.argv) > 1:
        raw = sys.argv[1]
    return json.loads(raw or "{}")


def export_cases(
    test_cases: list,
    test_code: str,
    output_dir: str,
    execution_result: dict | None = None,
    diagnosis: dict | None = None,
) -> dict:
    """
    导出测试用例文档和测试代码文件。

    生成文件列表：
    - test_generated.py：完整的pytest测试代码，可直接执行
    - test_cases.md：Markdown格式文档，包含3个章节：
      1. 测试用例表格（编号、标题、优先级、类型、前置条件、预期结果）
      2. 执行摘要（状态、通过/失败/错误数量、退出码、耗时、超时标记）
      3. 失败诊断（诊断类型、置信度、证据列表、建议动作）

    所有中文字符先经过clean_text处理，确保UTF-8编码正确。
    输出目录不存在时自动创建。
    """
    os.makedirs(output_dir, exist_ok=True)
    exported = []

    # (1) 导出 .py 测试代码文件
    py_path = os.path.join(output_dir, "test_generated.py")
    with open(py_path, "w", encoding="utf-8") as f:
        f.write(test_code)
    exported.append(py_path)

    # (2) 构建 .md 测试用例文档
    md_lines = [
        "# 测试用例文档\n",
        f"- 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 用例数量：{len(test_cases)}",
        "",
        "## 测试用例",
        "",
        "| 编号 | 标题 | 优先级 | 类型 | 前置条件 | 预期结果 |",
        "|------|------|--------|------|----------|----------|",
    ]
    for tc in test_cases:
        md_lines.append(
            f"| {clean_text(tc.get('case_number', 'N/A'))} "
            f"| {clean_text(tc.get('title', ''))} "
            f"| {clean_text(tc.get('priority', 'P3'))} "
            f"| {clean_text(tc.get('case_type', '功能'))} "
            f"| {clean_text(tc.get('preconditions', ''))} "
            f"| {clean_text(tc.get('expected_result', ''))} |"
        )

    # 执行摘要章节（仅在提供了执行结果时出现）
    if execution_result:
        md_lines.extend(
            [
                "",
                "## 执行摘要",
                "",
                f"- 状态：{execution_result.get('status', 'unknown')}",
                f"- 通过：{execution_result.get('passed', 0)}",
                f"- 失败：{execution_result.get('failed', 0)}",
                f"- 错误：{execution_result.get('errors', 0)}",
                f"- 退出码：{execution_result.get('exit_code', '')}",
                f"- 耗时：{execution_result.get('duration_ms', '')} ms",
                f"- 是否超时：{execution_result.get('timeout', False)}",
            ]
        )

    # 失败诊断章节（仅在提供了诊断结果时出现）
    if diagnosis:
        md_lines.extend(
            [
                "",
                "## 失败诊断",
                "",
                f"- 类型：{diagnosis.get('diagnosis_type', 'UNKNOWN')}",
                f"- 置信度：{diagnosis.get('confidence', '')}",
                f"- 建议动作：{diagnosis.get('next_action', '')}",
            ]
        )
        evidence = diagnosis.get("evidence", [])
        if evidence:
            md_lines.append("- 证据：")
            for item in evidence:
                md_lines.append(f"  - {clean_text(item)}")

    md_path = os.path.join(output_dir, "test_cases.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(clean_text("\n".join(md_lines)))
    exported.append(md_path)

    return {"exported_files": exported}


def clean_text(value) -> str:
    """
    清洗文本中的非法UTF-8字符
    通过编码→解码的往返操作过滤无法正确编码的字符，
    确保写入Markdown文件时不会出现乱码。
    """
    text = str(value)
    return text.encode("utf-8", errors="ignore").decode("utf-8", errors="ignore")


if __name__ == "__main__":
    """
    脚本入口：从stdin读取JSON输入，执行导出操作，
    输出统一的 { ok, data, error } JSON结构到stdout。
    """
    input_data = read_input()
    result = export_cases(
        input_data.get("test_cases", []),
        input_data.get("test_code", ""),
        input_data.get("output_dir", "./output"),
        input_data.get("execution_result"),
        input_data.get("diagnosis"),
    )
    output = {"ok": True, "data": result, "error": None}
    print(json.dumps(output, ensure_ascii=False))
