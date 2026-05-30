import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import { callPythonScript } from "../runtime/python-bridge.js"
import Parser from "tree-sitter"
import Java from "tree-sitter-java"
import Cpp from "tree-sitter-cpp"
import type { SyntaxNode } from "tree-sitter"

export interface ParsedSource {
  module_name: string
  imports: string[]
  classes: unknown[]
  functions: unknown[]
  warnings?: string[]
}

/**
 * 参数信息：参数名、类型注解和原始文本
 */
interface ParsedParam {
  name: string
  type: string
  raw: string
}

/**
 * 方法/函数签名信息
 */
interface ParsedFunction {
  name: string
  symbol_type: "function" | "method"
  params: ParsedParam[]
  return_type: string
  docstring: string
  start_line: number
  end_line: number
}

/**
 * 类定义信息
 */
interface ParsedClass {
  name: string
  bases: string[]
  docstring: string
  methods: ParsedFunction[]
  start_line: number
  end_line: number
}

/**
 * 统一源码解析入口：支持 Python、Java 和 C++ 三种语言
 * Python 使用标准库 ast 解析（通过 python-bridge 调用 parse_source.py）
 * Java 和 C++ 使用 Tree-sitter 进行 AST 解析
 *
 * @param inputData.source_code - 完整的源代码文本
 * @param inputData.filename - 源文件名
 * @param inputData.language - 语言标识（python/java/cpp）
 * @returns AST解析后的结构化信息
 */
export function parseSourceCode(inputData: {
  source_code: string
  filename: string
  language?: string
}): ParsedSource {
  const language = (inputData.language ?? "python").toLowerCase()

  if (language === "python" || language === "py") {
    return parsePython(inputData.source_code, inputData.filename)
  }
  if (language === "java") {
    return parseJava(inputData.source_code, inputData.filename)
  }
  if (language === "cpp" || language === "c++" || language === "cc") {
    return parseCpp(inputData.source_code, inputData.filename)
  }

  throw new Error(`不支持的语言: ${language}`)
}

function parsePython(sourceCode: string, filename: string): ParsedSource {
  const result = callPythonScript<ParsedSource>("parse_source.py", { source_code: sourceCode, filename }, 30_000)
  if (!result.ok || !result.data) {
    throw new Error(`代码解析失败: ${result.error?.message ?? "未知错误"}`)
  }
  return result.data
}

function parseJava(sourceCode: string, filename: string): ParsedSource {
  const parser = new Parser()
  parser.setLanguage(Java as never)
  const tree = parser.parse(sourceCode)
  const root = tree.rootNode

  const moduleName = extractJavaClassName(root) ?? filename.replace(/\.java$/i, "")
  const imports: string[] = []
  const warnings: string[] = []
  const classes: ParsedClass[] = []
  const functions: ParsedFunction[] = []

  // 遍历顶层节点
  for (let i = 0; i < root.namedChildren.length; i += 1) {
    const node = root.namedChildren[i]
    if (node.type === "import_declaration") {
      imports.push(node.text.replace(/^import\s+/, "").replace(/;$/, "").trim())
    }
    if (node.type === "class_declaration") {
      const parsed = extractJavaClass(node)
      if (parsed) classes.push(parsed)
    }
    if (node.type === "method_declaration") {
      const parsed = extractJavaMethod(node)
      if (parsed) functions.push({ ...parsed, symbol_type: "function" })
    }
  }

  if (classes.length === 0 && functions.length === 0) {
    warnings.push("NO_TESTABLE_SYMBOL: 未检测到 Java 类或方法")
  }

  return { module_name: moduleName, imports, classes, functions, warnings }
}

function parseCpp(sourceCode: string, filename: string): ParsedSource {
  const parser = new Parser()
  parser.setLanguage(Cpp as never)
  const tree = parser.parse(sourceCode)
  const root = tree.rootNode

  const moduleName = filename.replace(/\.(cpp|cc|cxx|hpp|h)$/i, "")
  const imports: string[] = []
  const warnings: string[] = []
  const classes: ParsedClass[] = []
  const functions: ParsedFunction[] = []

  // 收集所有顶层函数和各作用域内的成员
  const classMap = new Map<SyntaxNode, ParsedClass>()

  for (let i = 0; i < root.namedChildren.length; i += 1) {
    const node = root.namedChildren[i]
    if (node.type === "preproc_include") {
      const text = node.text.replace(/^#include\s+/, "").trim()
      const clean = text.replace(/^[<"]/, "").replace(/[>"]$/, "")
      if (clean) imports.push(clean)
    }
    if (node.type === "function_definition") {
      const parsed = extractCppFunction(node)
      if (parsed) functions.push(parsed)
    }
    if (node.type === "class_specifier") {
      const cls = extractCppClass(node)
      if (cls) {
        classes.push(cls)
        classMap.set(node, cls)
      }
    }
  }

  // 遍历类内部的成员函数
  for (const node of root.descendantsOfType("class_specifier")) {
    const cls = classMap.get(node)
    if (!cls) continue
    const body = node.childForFieldName("body")
    if (!body) continue
    for (let i = 0; i < body.namedChildren.length; i += 1) {
      const child = body.namedChildren[i]
      if (child.type === "function_definition") {
        const method = extractCppFunction(child)
        if (method) cls.methods.push({ ...method, symbol_type: "method" })
      }
    }
  }

  if (classes.length === 0 && functions.length === 0) {
    warnings.push("NO_TESTABLE_SYMBOL: 未检测到 C++ 函数或类")
  }

  return { module_name: moduleName, imports, classes, functions, warnings }
}

// ========== Tree-sitter AST 节点提取函数 ==========

function extractJavaClassName(root: SyntaxNode): string | undefined {
  for (let i = 0; i < root.namedChildren.length; i += 1) {
    const node = root.namedChildren[i]
    if (node.type === "class_declaration") {
      const nameNode = node.childForFieldName("name")
      if (nameNode) return nameNode.text
    }
  }
  return undefined
}

function extractJavaClass(node: SyntaxNode): ParsedClass | null {
  const nameNode = node.childForFieldName("name")
  if (!nameNode) return null

  const body = node.childForFieldName("body")
  const methods: ParsedFunction[] = []

  if (body) {
    for (let i = 0; i < body.namedChildren.length; i += 1) {
      const child = body.namedChildren[i]
      if (child.type === "method_declaration") {
        const method = extractJavaMethod(child)
        if (method) methods.push({ ...method, symbol_type: "method" })
      }
      if (child.type === "constructor_declaration") {
        const ctor = extractJavaConstructor(child)
        if (ctor) methods.push({ ...ctor, symbol_type: "method" })
      }
    }
  }

  // 提取父类/接口
  const bases = collectJavaBases(node)

  return {
    name: nameNode.text,
    bases,
    docstring: "",
    methods,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
  }
}

function collectJavaBases(node: SyntaxNode): string[] {
  const bases: string[] = []
  const superclass = node.childForFieldName("superclass")
  if (superclass) bases.push(superclass.text)
  const interfaces = node.childForFieldName("interfaces")
  if (interfaces) {
    for (let i = 0; i < interfaces.namedChildren.length; i += 1) {
      bases.push(interfaces.namedChildren[i].text)
    }
  }
  return bases
}

function extractJavaMethod(node: SyntaxNode): ParsedFunction | null {
  const nameNode = node.childForFieldName("name")
  if (!nameNode) return null

  const name = nameNode.text
  if (["if", "for", "while", "switch", "catch", "main"].includes(name)) return null

  const returnType = extractJavaReturnType(node)
  const params = extractJavaParams(node)
  const body = node.childForFieldName("body")
  const docstring = body ? extractJavaDocstring(body) : ""

  return {
    name,
    params,
    return_type: returnType,
    docstring,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    symbol_type: "method",
  }
}

function extractJavaConstructor(node: SyntaxNode): ParsedFunction | null {
  const nameNode = node.childForFieldName("name")
  if (!nameNode) return null

  const params = extractJavaParams(node)
  return {
    name: nameNode.text,
    params,
    return_type: nameNode.text,
    docstring: "",
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    symbol_type: "method",
  }
}

function extractJavaReturnType(node: SyntaxNode): string {
  const typeNode = node.childForFieldName("type")
  if (!typeNode) return "void"

  if (typeNode.type === "array_type") {
    const elementType = typeNode.childForFieldName("element")
    return elementType ? `${elementType.text}[]` : typeNode.text
  }
  if (typeNode.type === "generic_type") {
    const nameNode = typeNode.childForFieldName("name")
    const typeArgs = typeNode.childForFieldName("type_arguments")
    if (nameNode && typeArgs) return `${nameNode.text}<${typeArgs.namedChildren.map(c => c.text).join(", ")}>`
    return typeNode.text
  }
  return typeNode.text
}

function extractJavaParams(node: SyntaxNode): ParsedParam[] {
  const paramsNode = node.childForFieldName("parameters")
  if (!paramsNode) return []

  const params: ParsedParam[] = []
  for (let i = 0; i < paramsNode.namedChildren.length; i += 1) {
    const param = paramsNode.namedChildren[i]
    if (param.type === "formal_parameter" || param.type === "spread_parameter") {
      const typeNode = param.childForFieldName("type")
      const nameNode = param.childForFieldName("name")
      const raw = param.text
      const type = typeNode ? typeNode.text : "var"
      const name = nameNode ? nameNode.text : raw
      params.push({ name, type, raw })
    }
  }
  return params
}

function extractJavaDocstring(body: SyntaxNode): string {
  // 提取方法体上方最近的 block_comment
  const methodNode = body.parent
  if (!methodNode) return ""
  const program = methodNode.parent
  if (!program) return ""
  // 简单策略：检查上一个兄弟是否是注释
  const siblings = program.children
  for (let i = 1; i < siblings.length; i += 1) {
    if (siblings[i] === methodNode && siblings[i - 1].type === "block_comment") {
      return siblings[i - 1].text.replace(/^\/\*+/, "").replace(/\*+\/$/, "").trim()
    }
  }
  return ""
}

function extractCppClass(node: SyntaxNode): ParsedClass | null {
  const nameNode = node.childForFieldName("name")
  if (!nameNode) return null

  const bases = extractCppBases(node)
  const methods: ParsedFunction[] = []

  return {
    name: nameNode.text,
    bases,
    docstring: "",
    methods,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
  }
}

function extractCppBases(node: SyntaxNode): string[] {
  const bases: string[] = []
  const baseClause = node.childForFieldName("bases")
  if (!baseClause) return bases
  for (let i = 0; i < baseClause.namedChildren.length; i += 1) {
    bases.push(baseClause.namedChildren[i].text)
  }
  return bases
}

function extractCppFunction(node: SyntaxNode): ParsedFunction | null {
  const declarator = node.childForFieldName("declarator")
  if (!declarator) return null

  const { name, params } = extractCppDeclarator(declarator)
  if (!name) return null
  if (["if", "for", "while", "switch", "catch", "main"].includes(name)) return null

  const returnType = extractCppReturnType(node)
  const body = node.childForFieldName("body")
  const docstring = body ? "" : "" // C++ 通常没有 docstring 约定

  return {
    name,
    params,
    return_type: returnType,
    docstring,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    symbol_type: "function",
  }
}

function extractCppDeclarator(declarator: SyntaxNode): { name: string | null; params: ParsedParam[] } {
  let name: string | null = null
  const params: ParsedParam[] = []

  // 函数声明器有几种子节点：function_declarator, pointer_declarator 等
  // 找到最内层的 identifier 和 parameter_list
  const descend = (node: SyntaxNode): void => {
    for (let i = 0; i < node.namedChildren.length; i += 1) {
      const child = node.namedChildren[i]
      if (child.type === "identifier" && !name) {
        name = child.text
      }
      if (child.type === "parameter_list") {
        for (let j = 0; j < child.namedChildren.length; j += 1) {
          const param = child.namedChildren[j]
          if (param.type === "parameter_declaration") {
            const paramType = extractCppParamType(param)
            const paramNameNode = findNodeType(param, "identifier") || findNodeType(param, "pointer_declarator")
            const paramName = paramNameNode ? paramNameNode.text : ""
            params.push({
              name: paramName,
              type: paramType,
              raw: param.text,
            })
          }
        }
      }
      descend(child)
    }
  }

  descend(declarator)
  return { name, params }
}

function extractCppReturnType(node: SyntaxNode): string {
  // 返回类型是 function_definition 中除 declarator 和 body 之外的类型节点
  const declarator = node.childForFieldName("declarator")
  const types: string[] = []
  for (let i = 0; i < node.namedChildren.length; i += 1) {
    const child = node.namedChildren[i]
    if (child === declarator) continue
    if (child.type === "compound_statement") continue
    if (child.type.includes("type") || child.type === "qualified_identifier" || child.type === "template_type") {
      types.push(child.text)
    }
  }
  return types.length > 0 ? types.join(" ") : "void"
}

function extractCppParamType(paramNode: SyntaxNode): string {
  const types: string[] = []
  for (let i = 0; i < paramNode.namedChildren.length; i += 1) {
    const child = paramNode.namedChildren[i]
    if (child.type === "identifier" || child.type === "pointer_declarator" || child.type === "reference_declarator") continue
    if (child.type.includes("type") || child.type === "qualified_identifier") {
      types.push(child.text)
    }
  }
  return types.length > 0 ? types.join(" ") : "auto"
}

function findNodeType(node: SyntaxNode, typeName: string): SyntaxNode | null {
  for (let i = 0; i < node.namedChildren.length; i += 1) {
    const child = node.namedChildren[i]
    if (child.type === typeName) return child
  }
  for (let i = 0; i < node.namedChildren.length; i += 1) {
    const found = findNodeType(node.namedChildren[i], typeName)
    if (found) return found
  }
  return null
}

// ========== Mastra Tool 定义 ==========

export const parseSourceCodeTool = createTool({
  id: "parse-source-code",
  description:
    "多语言源代码静态解析工具：支持 Python、Java 和 C++。" +
    "Python 使用标准库 ast 解析，Java 和 C++ 使用 Tree-sitter AST 解析。" +
    "提取所有可测试符号（模块名/类名、导入列表、类定义及继承关系、方法/函数签名、" +
    "参数类型、返回值类型、起始行号和结束行号）。" +
    "该工具在读取源代码之后、生成测试用例之前调用。LLM 收到解析结果后应按每个函数/方法逐一设计测试用例。",
  inputSchema: z.object({
    source_code: z.string().describe("完整的源代码文本内容"),
    filename: z.string().describe("源文件名（如 user_service.py、MyClass.java、algorithm.cpp），用于推断模块名"),
    language: z.enum(["python", "java", "cpp"]).optional().describe("语言标识：python、java 或 cpp。默认为 python"),
  }),
  outputSchema: z.object({
    module_name: z.string().describe("模块名/类名"),
    imports: z.array(z.string()).describe("所有 import/#include 语句列表"),
    classes: z.array(z.any()).describe("所有类定义，每个类包含 name、bases、docstring、methods 子数组"),
    functions: z.array(z.any()).describe("所有顶层函数定义，每个函数包含 name、params、return_type、docstring、start_line、end_line"),
    warnings: z.array(z.string()).optional().describe("结构性警告（如文件过大或无测试符号）"),
  }),
  execute: async (inputData) => {
    return parseSourceCode({
      source_code: inputData.source_code,
      filename: inputData.filename,
      language: inputData.language ?? "python",
    })
  },
})
