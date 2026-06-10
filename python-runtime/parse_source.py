"""
AST 代码解析模块
使用Python标准库ast模块解析源代码，提取模块名、导入列表、类定义、方法签名、
函数签名、类型注解、文档注释和行号范围等结构化信息。
"""
import ast
import json
import sys
from pathlib import Path


def read_input() -> dict:
    """
    读取stdin或命令行参数的JSON输入
    优先从stdin读取（与Node.js spawnSync + input模式兼容），
    若stdin为空则回退到命令行参数（兼容旧调用方式）。
    """
    raw = sys.stdin.read().strip()
    if not raw and len(sys.argv) > 1:
        raw = sys.argv[1]
    return json.loads(raw or "{}")


def parse_source(source_code: str, filename: str = "unknown.py") -> dict:
    """
    解析Python源代码，提取模块、类、函数的结构化信息。
    
    解析流程：
    1. 使用ast.parse生成抽象语法树
    2. 遍历整棵树收集import语句（import/from...import）
    3. 遍历顶层节点提取类定义和函数定义
    4. 对每个函数/方法提取参数列表、类型注解、默认值和docstring
    5. 检查边界情况：空文件、超大文件、语法错误
    
    返回结构包含：
    - module_name: 从文件名推断的模块名
    - imports: 所有import语句列表
    - classes: 类定义列表（含方法子数组）
    - functions: 顶层函数定义列表
    - warnings: 结构性警告（如无测试符号、文件过大）
    """
    tree = ast.parse(source_code)
    result = {
        "module_name": Path(filename).stem,
        "imports": [],
        "classes": [],
        "functions": [],
        "warnings": [],
    }

    # 第一遍遍历：收集所有import语句
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                result["imports"].append(f"import {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            for alias in node.names:
                result["imports"].append(f"from {module} import {alias.name}")

    # 第二遍遍历：收集顶层类定义和函数定义
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.ClassDef):
            cls_info = {
                "name": node.name,
                "bases": [base.id for base in node.bases if isinstance(base, ast.Name)],
                "docstring": ast.get_docstring(node) or "",
                "methods": [],
                "start_line": node.lineno,
                "end_line": node.end_lineno,
            }
            # 遍历类内部，收集所有普通方法和异步方法
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    method_info = _parse_function(item)
                    method_info["symbol_type"] = "method"
                    cls_info["methods"].append(method_info)
            result["classes"].append(cls_info)

        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            func_info = _parse_function(node)
            func_info["symbol_type"] = "function"
            result["functions"].append(func_info)

    # 结构性警告
    symbol_count = len(result["functions"]) + sum(len(cls["methods"]) for cls in result["classes"])
    line_count = len(source_code.splitlines())
    if symbol_count == 0:
        result["warnings"].append("NO_TESTABLE_SYMBOL: 未发现可测试函数或方法")
    if line_count > 500 or symbol_count > 20:
        result["warnings"].append("LARGE_FILE: 文件较大，建议分批生成逻辑摘要和测试用例")

    return result


def _parse_function(node: ast.AST) -> dict:
    """
    解析单个函数或方法的签名信息。
    提取参数名称、类型注解、默认值和返回类型注解。
    对于方法会自动跳过self参数（通过default_offset机制处理）。
    """
    params = []
    args = getattr(node, "args")
    defaults = list(args.defaults)
    # 默认值参数排在最后，需要计算偏移量来对齐
    default_offset = len(args.args) - len(defaults)

    for index, arg in enumerate(args.args):
        param = {
            "name": arg.arg,
            "type": _get_annotation_str(arg.annotation) if arg.annotation else "Any",
            "default": (
                _literal_default(defaults[index - default_offset])
                if index >= default_offset
                else None
            ),
        }
        params.append(param)

    return_type = _get_annotation_str(node.returns) if node.returns else "Any"
    docstring = ast.get_docstring(node) or ""

    return {
        "name": node.name,
        "params": params,
        "return_type": return_type,
        "docstring": docstring,
        "start_line": node.lineno,
        "end_line": node.end_lineno,
    }


def _get_annotation_str(annotation) -> str:
    """
    将AST类型注解节点转为可读字符串。
    优先使用ast.unparse正常还原，失败时用Name/Constant回退解析。
    例如：ast.Name(id="str") → "str"
    """
    try:
        return ast.unparse(annotation)
    except Exception:
        if isinstance(annotation, ast.Name):
            return annotation.id
        if isinstance(annotation, ast.Constant):
            return str(annotation.value)
        return "?"


def _literal_default(node) -> str:
    """将AST默认值节点转为Python字面值字符串，如Num(n=1)→"1"."""
    try:
        return ast.unparse(node)
    except Exception:
        return "..."


if __name__ == "__main__":
    """
    脚本入口：从stdin或命令行参数读取JSON输入，解析源代码，
    输出统一的 { ok, data, error } JSON结构到stdout。
    """
    input_data = read_input()
    try:
        parsed = parse_source(input_data["source_code"], input_data.get("filename", "source.py"))
        output = {"ok": True, "data": parsed, "error": None}
    except SyntaxError as e:
        # 源代码存在语法错误时，返回结构化错误信息
        output = {
            "ok": False,
            "data": None,
            "error": {
                "code": "PARSE_SYNTAX_ERROR",
                "message": f"语法错误 at line {e.lineno}: {e.msg}",
                "details": {"line": e.lineno, "offset": e.offset, "text": e.text},
            },
        }
    print(json.dumps(output, ensure_ascii=False))
