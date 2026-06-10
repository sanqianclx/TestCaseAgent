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
    quality: dict | None = None,
    coverage: dict | None = None,
    versions: list | None = None,
    artifact_prefix: str | None = None,
    skip_py: bool = False,
) -> dict:
    os.makedirs(output_dir, exist_ok=True)
    exported: list[str] = []

    suffix = _safe_suffix(artifact_prefix)
    py_filename = f"test_generated_{suffix}.py" if suffix else "test_generated.py"
    md_filename = f"test_cases_{suffix}.md" if suffix else "test_cases.md"

    if not skip_py:
        py_path = os.path.join(output_dir, py_filename)
        with open(py_path, "w", encoding="utf-8") as f:
            f.write(test_code)
        exported.append(py_path)

    md_lines = [
        "# 单元测试生成报告",
        "",
        f"- 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 测试用例数：{len(test_cases)}",
        "",
        "## 测试用例",
        "",
        "| 编号 | 标题 | 类型 | 输入参数 | 前置条件 | 预期结果 |",
        "| --- | --- | --- | --- | --- | --- |",
    ]

    for tc in test_cases:
        params = tc.get("input_params")
        params_str = _format_params(params) if params else "-"
        md_lines.append(
            f"| {clean_text(tc.get('case_number', 'N/A'))} "
            f"| {clean_text(tc.get('title', ''))} "
            f"| {clean_text(tc.get('case_type', ''))} "
            f"| {clean_text(params_str)} "
            f"| {clean_text(tc.get('preconditions', ''))} "
            f"| {clean_text(tc.get('expected_result', ''))} |"
        )

    if coverage:
        md_lines.extend([
            "",
            "## 覆盖率",
            "",
            f"- 符号覆盖率：{coverage.get('symbol_coverage', 0)}%",
            f"- 已覆盖符号：{len(coverage.get('covered_symbols', []))}/{coverage.get('total_symbols', 0)}",
            f"- 总测试用例数：{coverage.get('total_cases', len(test_cases))}",
        ])
        line_rate = coverage.get("line_rate", 0)
        coverage_tool = coverage.get("coverage_tool", "symbol-only")
        if line_rate > 0:
            md_lines.extend([
                f"- 真实行覆盖率：{line_rate}%（工具：{coverage_tool}）",
                f"- 已覆盖行数：{coverage.get('covered_lines', 0)}/{coverage.get('total_lines', 0)}",
                f"- 分支覆盖率：{coverage.get('branch_rate', 0)}%",
            ])
        else:
            md_lines.append(f"- 行覆盖率：{coverage_tool}（目前仅有符号覆盖率）")
        case_type_coverage = coverage.get("case_type_coverage") or {}
        if case_type_coverage:
            md_lines.append("- 用例类型分布：")
            for key, value in case_type_coverage.items():
                md_lines.append(f"  - {clean_text(key)}: {value}%")
        uncovered = coverage.get("uncovered_symbols") or []
        if uncovered:
            md_lines.append("- 未覆盖符号：")
            for item in uncovered:
                md_lines.append(f"  - {clean_text(item)}")

    if execution_result:
        md_lines.extend([
            "",
            "## 执行摘要",
            "",
            f"- 状态：{execution_result.get('status', 'unknown')}",
            f"- 通过：{execution_result.get('passed', 0)}",
            f"- 失败：{execution_result.get('failed', 0)}",
            f"- 错误：{execution_result.get('errors', 0)}",
            f"- 退出码：{execution_result.get('exit_code', '')}",
            f"- 耗时：{execution_result.get('duration_ms', '')} 毫秒",
            f"- 超时：{execution_result.get('timeout', False)}",
        ])

        test_results = execution_result.get("test_results", [])
        if test_results:
            md_lines.extend([
                "",
                "## 逐用例结果",
                "",
                "| # | 测试 | 结果 |",
                "| --- | --- | --- |",
            ])
            for idx, tr in enumerate(test_results, 1):
                test_class = tr.get("test_class", "")
                test_name = tr.get("test_name", "?")
                name = f"{test_class}.{test_name}" if test_class else test_name
                md_lines.append(
                    f"| {idx} | {clean_text(name)} | {clean_text(tr.get('result', '?'))} |"
                )

    if diagnosis:
        diagnosis_text = diagnosis.get("report_text") or diagnosis.get("summary") or json.dumps(diagnosis, ensure_ascii=False, indent=2)
        # 直接插入 LLM 原始输出,让 markdown 渲染器自然处理(LLM 自带的
        # ### 标题、表格、列表、``` 代码块全部正常解析为对应 HTML)
        # 不再用 <pre> 等宽字体(丑)+ 不用 clean_text 把 \n 换成 <br>(会破坏段落)
        md_lines.extend([
            "",
            "## AI 失败诊断",
            "",
            diagnosis_text,
        ])

    if versions:
        md_lines.extend([
            "",
            "## 测试代码版本历史",
            "",
            "| 版本 | 尝试次数 | 执行状态 | 质量 | 内部决策 | 备注 |",
            "| --- | --- | --- | --- | --- | --- |",
        ])
        for version in versions:
            exec_result = version.get("execution_result") or {}
            quality_result = version.get("quality") or {}
            diagnosis_result = version.get("diagnosis") or {}
            md_lines.append(
                f"| v{version.get('version_no', '?')} "
                f"| {version.get('attempt', '?')} "
                f"| {clean_text(exec_result.get('status', 'not_run'))} "
                f"| {'passed' if quality_result.get('ok') else 'failed'} "
                f"| {clean_text(diagnosis_result.get('next_action', '-'))} "
                f"| {clean_text(version.get('note', '-'))} |"
            )

    md_path = os.path.join(output_dir, md_filename)
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines))
    exported.append(md_path)

    return {"exported_files": exported}


def _format_params(params: dict) -> str:
    if not params or not isinstance(params, dict):
        return "-"
    return ", ".join(f"{k}={v!r}" for k, v in params.items())[:120]


def _safe_suffix(value: str | None) -> str:
    if not value:
        return ""
    safe = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in str(value))
    return safe.strip("_")[:40]


def clean_text(value) -> str:
    return str(value).replace("\n", "<br>").replace("|", "\\|")


if __name__ == "__main__":
    input_data = read_input()
    result = export_cases(
        input_data.get("test_cases", []),
        input_data.get("test_code", ""),
        input_data.get("output_dir", "./output"),
        input_data.get("execution_result"),
        input_data.get("diagnosis"),
        input_data.get("quality"),
        input_data.get("coverage"),
        input_data.get("versions"),
        input_data.get("artifact_prefix"),
        input_data.get("skip_py", False),
    )
    print(json.dumps({"ok": True, "data": result, "error": None}, ensure_ascii=False))
