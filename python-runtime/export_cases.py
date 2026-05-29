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
        "# Unit Test Generation Report",
        "",
        f"- Generated at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"- Test cases: {len(test_cases)}",
        "",
        "## Test Cases",
        "",
        "| ID | Title | Type | Input Params | Preconditions | Expected Result |",
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
            "## Coverage",
            "",
            f"- Symbol coverage: {coverage.get('symbol_coverage', 0)}%",
            f"- Covered symbols: {len(coverage.get('covered_symbols', []))}/{coverage.get('total_symbols', 0)}",
            f"- Total test cases: {coverage.get('total_cases', len(test_cases))}",
        ])
        case_type_coverage = coverage.get("case_type_coverage") or {}
        if case_type_coverage:
            md_lines.append("- Case type distribution:")
            for key, value in case_type_coverage.items():
                md_lines.append(f"  - {clean_text(key)}: {value}%")
        uncovered = coverage.get("uncovered_symbols") or []
        if uncovered:
            md_lines.append("- Uncovered symbols:")
            for item in uncovered:
                md_lines.append(f"  - {clean_text(item)}")

    if execution_result:
        md_lines.extend([
            "",
            "## Execution Summary",
            "",
            f"- Status: {execution_result.get('status', 'unknown')}",
            f"- Passed: {execution_result.get('passed', 0)}",
            f"- Failed: {execution_result.get('failed', 0)}",
            f"- Errors: {execution_result.get('errors', 0)}",
            f"- Exit code: {execution_result.get('exit_code', '')}",
            f"- Duration: {execution_result.get('duration_ms', '')} ms",
            f"- Timeout: {execution_result.get('timeout', False)}",
        ])

        test_results = execution_result.get("test_results", [])
        if test_results:
            md_lines.extend([
                "",
                "## Per-Test Results",
                "",
                "| # | Test | Result | Failure Reason |",
                "| --- | --- | --- | --- |",
            ])
            for idx, tr in enumerate(test_results, 1):
                test_class = tr.get("test_class", "")
                test_name = tr.get("test_name", "?")
                name = f"{test_class}.{test_name}" if test_class else test_name
                md_lines.append(
                    f"| {idx} | {clean_text(name)} | {clean_text(tr.get('result', '?'))} | "
                    f"{clean_text(tr.get('failure_reason', '-') or '-')} |"
                )

    if quality:
        md_lines.extend([
            "",
            "## Quality Check",
            "",
            f"- Result: {'passed' if quality.get('ok') else 'failed'}",
            f"- Checked tests: {quality.get('checked_tests', '')}",
        ])
        issues = quality.get("issues", [])
        if issues:
            md_lines.append("- Issues:")
            for item in issues:
                md_lines.append(f"  - {clean_text(item)}")

    if diagnosis:
        md_lines.extend([
            "",
            "## AI Failure Diagnosis",
            "",
            clean_text(diagnosis.get("report_text") or diagnosis.get("summary") or json.dumps(diagnosis, ensure_ascii=False, indent=2)),
        ])

    if versions:
        md_lines.extend([
            "",
            "## Test Code Version History",
            "",
            "| Version | Attempt | Execution Status | Quality | Internal Decision | Note |",
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
