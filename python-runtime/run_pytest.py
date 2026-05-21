"""
pytest 测试执行模块
"""
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def read_input() -> dict:
    raw = sys.stdin.read().strip()
    if not raw and len(sys.argv) > 1:
        raw = sys.argv[1]
    return json.loads(raw or "{}")


def run_pytest(test_code: str, source_code: str, filename: str = "source_temp.py", timeout: int = 60) -> dict:
    """在临时目录中执行pytest并返回结构化结果。"""
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

        start = time.time()
        timeout_flag = False

        try:
            result = subprocess.run(
                [sys.executable, "-m", "pytest", test_file, "-v", "--tb=short", "--no-header"],
                cwd=tmpdir,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as e:
            timeout_flag = True
            result = e

        duration_ms = int((time.time() - start) * 1000)

        if timeout_flag:
            return {
                "status": "timeout",
                "passed": 0,
                "failed": 0,
                "errors": 0,
                "stdout": result.stdout if hasattr(result, "stdout") else "",
                "stderr": "执行超时",
                "exit_code": -1,
                "duration_ms": duration_ms,
                "timeout": True,
            }

        passed = result.stdout.count(" PASSED")
        failed = result.stdout.count(" FAILED")
        errors = result.stdout.count(" ERROR")
        if result.returncode != 0 and passed == 0 and failed == 0 and errors == 0:
            errors = 1

        return {
            "status": "failed" if failed > 0 or errors > 0 else "passed",
            "passed": passed,
            "failed": failed,
            "errors": errors,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "exit_code": result.returncode,
            "duration_ms": duration_ms,
            "timeout": False,
        }


if __name__ == "__main__":
    input_data = read_input()
    result = run_pytest(
        input_data["test_code"],
        input_data["source_code"],
        input_data.get("filename", "source_temp.py"),
        input_data.get("timeout", 60),
    )
    output = {"ok": True, "data": result, "error": None}
    print(json.dumps(output, ensure_ascii=False))
