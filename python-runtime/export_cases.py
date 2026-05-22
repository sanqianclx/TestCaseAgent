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
    优先从stdin读取，
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
    quality: dict | None = None,
    versions: list | None = None,
    artifact_prefix: str | None = None,
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

    suffix = _safe_suffix(artifact_prefix)
    py_filename = f"test_generated_{suffix}.py" if suffix else "test_generated.py"
    md_filename = f"test_cases_{suffix}.md" if suffix else "test_cases.md"

    # (1) 导出 .py 测试代码文件
    py_path = os.path.join(output_dir, py_filename)
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
        "| 编号 | 标题 | 类型 | 输入参数 | 前置条件 | 预期结果 |",
        "|------|------|------|----------|----------|----------|",
    ]
    for tc in test_cases:
        params = tc.get("input_params")
        params_str = _format_params(params) if params else "-"
        md_lines.append(
            f"| {clean_text(tc.get('case_number', 'N/A'))} "
            f"| {clean_text(tc.get('title', ''))} "
            f"| {clean_text(tc.get('case_type', '功能'))} "
            f"| {clean_text(params_str)} "
            f"| {clean_text(tc.get('preconditions', ''))} "
            f"| {clean_text(tc.get('expected_result', ''))} |"
        )

    # 逐用例执行结果章节（仅在提供了执行结果时出现）
    # 以一目了然的表格展示每个测试函数的通过/失败状态和失败原因
    if execution_result:
        test_results = execution_result.get("test_results", [])
        if test_results:
            md_lines.extend(
                [
                    "",
                    "## 逐用例执行结果",
                    "",
                    "| 序号 | 测试函数 | 结果 | 失败原因 |",
                    "|------|----------|------|----------|",
                ]
            )
            for idx, tr in enumerate(test_results, 1):
                test_class = tr.get("test_class", "")
                test_name = tr.get("test_name", "?")
                name = f"{test_class}.{test_name}" if test_class else test_name
                result_label = tr.get("result", "?")
                if result_label == "PASSED":
                    icon = "✅ 通过"
                    reason = "-"
                elif result_label == "FAILED":
                    icon = "❌ 失败"
                    reason = clean_text(tr.get("failure_reason", "")) or "断言不通过"
                else:
                    icon = "⚠️ 错误"
                    reason = clean_text(tr.get("failure_reason", "")) or "执行异常"

                md_lines.append(
                    f"| {idx} "
                    f"| {clean_text(name)} "
                    f"| {icon} "
                    f"| {clean_text(reason)} |"
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

    # 质量检查章节（仅在提供了质量检查结果时出现）
    if quality:
        ok = quality.get("ok", False)
        md_lines.extend(
            [
                "",
                "## 质量检查",
                "",
                f"- 结果：{'通过' if ok else '未通过'}",
                f"- 检查到的测试函数数：{quality.get('checked_tests', '')}",
            ]
        )
        issues = quality.get("issues", [])
        if issues:
            md_lines.append("- 问题：")
            for item in issues:
                md_lines.append(f"  - {clean_text(item)}")

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

    # 版本记录章节（V2.0自愈循环使用）
    if versions:
        md_lines.extend(
            [
                "",
                "## 测试代码版本记录",
                "",
                "| 版本 | 尝试轮次 | 执行状态 | 质量结果 | 诊断类型 | 说明 |",
                "|------|----------|----------|----------|----------|------|",
            ]
        )
        for version in versions:
            exec_result = version.get("execution_result") or {}
            quality_result = version.get("quality") or {}
            diagnosis_result = version.get("diagnosis") or {}
            md_lines.append(
                f"| v{version.get('version_no', '?')} "
                f"| {version.get('attempt', '?')} "
                f"| {clean_text(exec_result.get('status', 'not_run'))} "
                f"| {'通过' if quality_result.get('ok') else '未通过'} "
                f"| {clean_text(diagnosis_result.get('diagnosis_type', '-'))} "
                f"| {clean_text(version.get('note', '-'))} |"
            )

    md_path = os.path.join(output_dir, md_filename)
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(clean_text("\n".join(md_lines)))
    exported.append(md_path)

    return {"exported_files": exported}


def _format_params(params: dict) -> str:
    """将输入参数字典格式化为简洁可读的字符串，如 a=3, b=5。"""
    if not params or not isinstance(params, dict):
        return "-"
    items = [f"{k}={v!r}" for k, v in params.items()]
    return ", ".join(items)[:80]


def _safe_suffix(value: str | None) -> str:
    """将导出阶段名转换为安全文件名后缀。"""
    if not value:
        return ""
    safe = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in str(value))
    return safe.strip("_")[:40]


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
        input_data.get("quality"),
        input_data.get("versions"),
        input_data.get("artifact_prefix"),
    )
    output = {"ok": True, "data": result, "error": None}
    print(json.dumps(output, ensure_ascii=False))
