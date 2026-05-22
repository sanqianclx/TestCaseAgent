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

        # 统计通过/失败/错误数量，并解析逐用例结果
        test_results = _parse_test_results(result.stdout)
        passed = sum(1 for t in test_results if t["result"] == "PASSED")
        failed = sum(1 for t in test_results if t["result"] == "FAILED")
        errors = sum(1 for t in test_results if t["result"] == "ERROR")
        if result.returncode != 0 and len(test_results) == 0:
            errors = 1
            test_results.append(_build_fallback_result(result))

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
            "test_results": test_results,
        }


def _parse_test_results(stdout: str) -> list[dict]:
    """
    从pytest -v --tb=short 输出中解析逐用例执行结果。

    两遍扫描：
      第一遍：收集所有 PASSED/FAILED/ERROR 行
      第二遍：解析 FAILURES 区块，提取"实际行为 vs 预期行为"的详细信息
    """
    import re

    line_pattern = re.compile(
        r"^(test_temp\.py)::(\w+)::(\w+)\s+(PASSED|FAILED|ERROR)\b"
    )
    lines = stdout.split("\n")

    # 第一遍：收集逐用例状态
    results: list[dict] = []
    for line in lines:
        m = line_pattern.match(line)
        if m:
            results.append({
                "test_file": m.group(1),
                "test_class": m.group(2),
                "test_name": m.group(3),
                "result": m.group(4),
                "failure_reason": "",
            })

    # 第二遍：解析 FAILURES 区块
    failure_details = _parse_failure_details(lines)

    # 合并：为每个 FAILED 用例查找详细原因
    for r in results:
        if r["result"] == "FAILED":
            key = f"{r['test_class']}.{r['test_name']}"
            r["failure_reason"] = failure_details.get(key, "断言失败，无详细信息")

    return results


def _parse_failure_details(lines: list[str]) -> dict[str, str]:
    """

    解析 pytest FAILURES 区块，为每个失败的测试函数提取行为描述。

    输入示例：
      ______________________ TestBadMath.test_basic ______________________
      test_temp.py:45: in test_basic
          assert bad_math(3, 5) == 15
      E   assert 8 == 15

      __________________ TestFaultyLogic.test_score_60 __________________
      test_temp.py:56: in test_score_60
          assert faulty_logic(60) == '通过'
      E   AssertionError: assert '不通过' == '通过'

    输出示例：
      {
        "TestBadMath.test_basic": "bad_math(3, 5) → 实际返回 8，预期 15",
        "TestFaultyLogic.test_score_60": "faulty_logic(60) → 实际返回 '不通过'，预期 '通过'",
      }
    """
    import re

    # 匹配测试函数标题行
    title_pattern = re.compile(r"^_+\s+(\w+)\.(\w+)\s+_+$")
    # 匹配 assert 行
    assert_pattern = re.compile(r"^\s*assert\s+(.+)$")
    # 匹配 E assert 行（兼容 E assert ... 和 E AssertionError: assert ... 两种格式）
    e_assert_pattern = re.compile(r"^E\s+(?:AssertionError:\s*)?assert\s+(.+)$")

    details: dict[str, str] = {}
    i = 0
    while i < len(lines):
        tm = title_pattern.match(lines[i])
        if tm:
            key = f"{tm.group(1)}.{tm.group(2)}"
            j = i + 1
            assert_call = ""
            actual_vs_expected = ""
            while j < len(lines) and not title_pattern.match(lines[j]):
                line = lines[j].strip()
                am = assert_pattern.match(line)
                if am:
                    assert_call = am.group(1)
                em = e_assert_pattern.match(line)
                if em:
                    actual_vs_expected = em.group(1)
                # 如果到了下一个标题行，跳出
                if title_pattern.match(line):
                    break
                j += 1

            if assert_call and actual_vs_expected:
                details[key] = _format_failure(assert_call, actual_vs_expected)
            elif assert_call:
                details[key] = f"断言失败：{assert_call}"
            i = j + 1
        else:
            i += 1

    return details


def _format_failure(assert_line: str, e_line: str) -> str:
    """

    将 assert 行和 E assert 行组合成人类可读的失败描述。

      assert bad_math(3, 5) == 15
      E   assert 8 == 15
      → "bad_math(3, 5) → 实际返回 8，预期 15"

      assert faulty_logic(60) == '通过'
      E   AssertionError: assert '不通过' == '通过'
      → "faulty_logic(60) → 实际返回 '不通过'，预期 '通过'"
    """
    call_part = assert_line
    call_op = ""
    for op in [" == ", " != ", " <= ", " >= ", " < ", " > ", " is not ", " is "]:
        idx = assert_line.find(op)
        if idx > 0:
            call_part = assert_line[:idx].strip()
            call_op = op.strip()
            break

    # 从 E assert 行提取实际值和预期值
    for op in [" == ", " != ", " <= ", " >= "]:
        if op in e_line:
            parts = e_line.split(op, 1)
            actual = parts[0].strip()
            expected = parts[1].strip()
            if call_part:
                op_label = {"==": "实际返回", "!=": "实际等于", "<=": "实际返回", ">=": "实际返回"}.get(op.strip(), "实际返回")
                return f"{call_part} → {op_label} {actual}，预期 {op.strip()} {expected}"
            break

    # 退路
    if call_part and call_part != assert_line:
        return f"{assert_line} | {e_line}"
    return f"{assert_line} | {e_line}"


def _build_fallback_result(result) -> dict:
    """当 stdout 无结构化输出时，用退出码构造兜底结果。"""
    return {
        "test_file": "test_temp.py",
        "test_class": "-",
        "test_name": "-",
        "result": "ERROR",
        "failure_reason": result.stderr.strip()[:200] if result.stderr else f"退出码 {result.returncode}",
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
