"""
pytest 测试执行模块
在临时工作目录中以沙箱方式执行pytest，捕获标准输出、标准错误、退出码和耗时。
执行完成后自动清理临时目录。
"""
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path


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


def run_pytest(
    test_code: str,
    source_code: str,
    filename: str = "source_temp.py",
    timeout: int = 60,
) -> dict:
    """
    在临时工作目录中隔离执行pytest并返回结构化结果。

    执行流程：
    1. 创建临时目录
    2. 将测试代码和源代码分别写入临时目录（保持原始文件名以支持正确import）
    3. 使用当前Python解释器以子进程方式执行pytest
    4. 捕获stdout、stderr、退出码和耗时
    5. 超时自动终止，超时结果单独标记
    6. 执行结束后自动清理临时目录

    返回结构包含status、passed、failed、errors、stdout、stderr、
    exit_code、duration_ms、timeout等字段。
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = os.path.join(tmpdir, "test_temp.py")
        # 保持原始文件名以支持from...import语句正常解析
        safe_name = Path(filename).name
        if not safe_name.endswith(".py"):
            safe_name = "source_temp.py"
        source_file = os.path.join(tmpdir, safe_name)

        # 写入测试代码和源代码到临时目录
        with open(test_file, "w", encoding="utf-8") as f:
            f.write(test_code)
        with open(source_file, "w", encoding="utf-8") as f:
            f.write(source_code)

        start = time.time()
        timeout_flag = False

        try:
            # 使用当前Python解释器的pytest模块执行，确保环境一致
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

        # 超时情况：单独返回timeout状态
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

        # 统计通过/失败/错误数量
        passed = result.stdout.count(" PASSED")
        failed = result.stdout.count(" FAILED")
        errors = result.stdout.count(" ERROR")
        # pytest退出码非0但没有明确标注的用例，全部归为错误
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
    """
    脚本入口：从stdin读取JSON输入，执行pytest，
    输出统一的 { ok, data, error } JSON结构到stdout。
    """
    input_data = read_input()
    result = run_pytest(
        input_data["test_code"],
        input_data["source_code"],
        input_data.get("filename", "source_temp.py"),
        input_data.get("timeout", 60),
    )
    output = {"ok": True, "data": result, "error": None}
    print(json.dumps(output, ensure_ascii=False))
