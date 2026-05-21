"""
AST 代码解析模块
"""
import ast
import json
import sys
from pathlib import Path


def read_input() -> dict:
    raw = sys.stdin.read().strip()
    if not raw and len(sys.argv) > 1:
        raw = sys.argv[1]
    return json.loads(raw or "{}")


def parse_source(source_code: str, filename: str = "unknown.py") -> dict:
    """解析Python源代码，提取模块、类、函数的结构化信息。"""
    tree = ast.parse(source_code)
    result = {
        "module_name": Path(filename).stem,
        "imports": [],
        "classes": [],
        "functions": [],
        "warnings": [],
    }

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                result["imports"].append(f"import {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            for alias in node.names:
                result["imports"].append(f"from {module} import {alias.name}")

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

    symbol_count = len(result["functions"]) + sum(len(cls["methods"]) for cls in result["classes"])
    line_count = len(source_code.splitlines())
    if symbol_count == 0:
        result["warnings"].append("NO_TESTABLE_SYMBOL: 未发现可测试函数或方法")
    if line_count > 500 or symbol_count > 20:
        result["warnings"].append("LARGE_FILE: 文件较大，建议分批生成逻辑摘要和测试用例")

    return result


def _parse_function(node: ast.AST) -> dict:
    """解析单个函数/方法的签名信息。"""
    params = []
    args = getattr(node, "args")
    defaults = list(args.defaults)
    default_offset = len(args.args) - len(defaults)

    for index, arg in enumerate(args.args):
        param = {
            "name": arg.arg,
            "type": _get_annotation_str(arg.annotation) if arg.annotation else "Any",
            "default": _literal_default(defaults[index - default_offset]) if index >= default_offset else None,
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
    """将AST类型注解节点转为字符串。"""
    try:
        return ast.unparse(annotation)
    except Exception:
        if isinstance(annotation, ast.Name):
            return annotation.id
        if isinstance(annotation, ast.Constant):
            return str(annotation.value)
        return "?"


def _literal_default(node) -> str:
    try:
        return ast.unparse(node)
    except Exception:
        return "..."


if __name__ == "__main__":
    input_data = read_input()
    try:
        parsed = parse_source(input_data["source_code"], input_data.get("filename", "source.py"))
        output = {"ok": True, "data": parsed, "error": None}
    except SyntaxError as e:
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
