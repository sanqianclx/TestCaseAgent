"""
结果导出模块
"""
import json
import os
import sys
from datetime import datetime


def read_input() -> dict:
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
    """导出测试用例文档和测试代码文件。"""
    os.makedirs(output_dir, exist_ok=True)
    exported = []

    py_path = os.path.join(output_dir, "test_generated.py")
    with open(py_path, "w", encoding="utf-8") as f:
        f.write(test_code)
    exported.append(py_path)

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
    text = str(value)
    return text.encode("utf-8", errors="ignore").decode("utf-8", errors="ignore")


if __name__ == "__main__":
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
