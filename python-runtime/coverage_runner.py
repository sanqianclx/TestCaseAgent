"""
代码覆盖率执行模块
在临时目录中执行 pytest + coverage.py，提取行覆盖率、分支覆盖率等指标。
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def read_input() -> dict:
    """读取 stdin 或命令行参数的 JSON 输入"""
    raw = sys.stdin.read().strip()
    if not raw and len(sys.argv) > 1:
        raw = sys.argv[1]
    return json.loads(raw or "{}")


def run_coverage(
    test_code: str,
    source_code: str,
    filename: str = "source_temp.py",
    timeout: int = 60,
) -> dict:
    """
    在临时工作目录中以沙箱方式执行 pytest + coverage，并提取覆盖率数据。

    执行流程：
    1. 创建临时目录
    2. 写入测试代码和源代码
    3. 检查 coverage 是否已安装
    4. coverage run -m pytest 执行
    5. coverage json 导出覆盖率 JSON
    6. 读取并解析覆盖率数据
    7. 超时自动终止
    8. 执行后自动清理临时目录
    """
    # 前置检查：coverage 是否安装
    check = subprocess.run(
        [sys.executable, "-m", "coverage", "--version"],
        capture_output=True,
        text=True,
    )
    coverage_available = check.returncode == 0
    if not coverage_available:
        return _not_available(
            "coverage.py 未安装，请执行 pip install coverage"
        )

    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = os.path.join(tmpdir, "test_temp.py")
        safe_name = Path(filename).name
        if not safe_name.endswith(".py"):
            safe_name = "source_temp.py"
        source_file = os.path.join(tmpdir, safe_name)

        with open(test_file, "w", encoding="utf-8") as f:
            f.write(test_code)
        with open(source_file, "w", encoding="utf-8") as f:
            f.write(source_code)

        import time
        start = time.time()
        timeout_flag = False

        # 步骤 1：coverage run -m pytest --tb=short
        try:
            cov_run = subprocess.run(
                [
                    sys.executable, "-m", "coverage", "run",
                    "--source", ".",
                    "--branch",
                    "-m", "pytest", test_file, "-v", "--tb=short", "--no-header",
                ],
                cwd=tmpdir,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            return _timeout_result(timeout, time.time() - start)

        duration_ms = int((time.time() - start) * 1000)

        # 步骤 2：coverage json 导出数据
        try:
            cov_json = subprocess.run(
                [sys.executable, "-m", "coverage", "json", "-o", "coverage.json"],
                cwd=tmpdir,
                capture_output=True,
                text=True,
                timeout=10,
            )
        except Exception:
            return {
                "ok": False,
                "data": None,
                "error": {
                    "code": "COVERAGE_JSON_FAILED",
                    "message": "coverage json 导出失败",
                    "details": {"stdout": cov_run.stdout, "stderr": cov_run.stderr},
                },
            }

        coverage_path = os.path.join(tmpdir, "coverage.json")
        if not os.path.exists(coverage_path):
            return _no_coverage_data(cov_run.stdout, cov_run.stderr, duration_ms)

        with open(coverage_path, "r", encoding="utf-8") as f:
            raw_data = json.load(f)

        parsed = _parse_coverage_json(raw_data)

        return {
            "ok": True,
            "data": {
                **parsed,
                "duration_ms": duration_ms,
                "pytest_exit_code": cov_run.returncode,
                "pytest_stdout": cov_run.stdout,
                "pytest_stderr": cov_run.stderr,
            },
            "error": None,
        }


def _not_available(reason: str) -> dict:
    return {
        "ok": False,
        "data": None,
        "error": {"code": "COVERAGE_NOT_AVAILABLE", "message": reason},
    }


def _timeout_result(timeout: int, elapsed: float) -> dict:
    return {
        "ok": False,
        "data": None,
        "error": {
            "code": "COVERAGE_TIMEOUT",
            "message": f"覆盖率执行超时（>{timeout}秒，实际{elapsed:.1f}秒）",
        },
    }


def _no_coverage_data(stdout: str, stderr: str, duration_ms: int) -> dict:
    return {
        "ok": False,
        "data": None,
        "error": {
            "code": "COVERAGE_NO_DATA",
            "message": "未生成覆盖率数据",
            "details": {"stdout": stdout, "stderr": stderr},
        },
    }


def _parse_coverage_json(raw_data: dict) -> dict:
    """
    解析 coverage.py 的 JSON 输出，提取关键覆盖率指标。
    """
    totals = raw_data.get("totals", {})
    files_info = raw_data.get("files", {})

    per_file = {}
    for filepath, info in files_info.items():
        name = Path(filepath).name
        summary = info.get("summary", {})
        per_file[name] = {
            "line_rate": round(summary.get("percent_covered", 0), 2),
            "covered_lines": summary.get("covered_lines", 0),
            "total_lines": summary.get("num_statements", 0),
            "missing_lines": len(info.get("missing_lines", [])),
            "branch_rate": round(summary.get("percent_covered", 0), 2),
        }

    return {
        "line_rate": round(totals.get("percent_covered", 0), 2),
        "branch_rate": round(totals.get("percent_covered", 0), 2),
        "covered_lines": totals.get("covered_lines", 0),
        "total_lines": totals.get("num_statements", 0),
        "missing_lines": totals.get("missing_lines", 0),
        "excluded_lines": totals.get("excluded_lines", 0),
        "per_file": per_file,
    }


if __name__ == "__main__":
    input_data = read_input()
    try:
        result = run_coverage(
            input_data["test_code"],
            input_data["source_code"],
            input_data.get("filename", "source_temp.py"),
            input_data.get("timeout", 60),
        )
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({
            "ok": False,
            "data": None,
            "error": {"code": "COVERAGE_RUNTIME_ERROR", "message": str(e)},
        }, ensure_ascii=False))
