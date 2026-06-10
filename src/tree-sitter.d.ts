declare module "tree-sitter" {
  export class SyntaxNode {
    type: string
    text: string
    startIndex: number
    endIndex: number
    startPosition: { row: number; column: number }
    endPosition: { row: number; column: number }
    namedChildren: SyntaxNode[]
    children: SyntaxNode[]
    parent: SyntaxNode | null
    rootNode: SyntaxNode | null

    /**
     * 按字段名获取子节点（如 declarator, body 等）
     */
    childForFieldName(fieldName: string): SyntaxNode | null

    /**
     * 查找指定类型的所有后代节点
     */
    descendantsOfType(type: string): SyntaxNode[]
  }

  export class Tree {
    rootNode: SyntaxNode
  }

  export default class Parser {
    /**
     * 设置当前解析的语言
     */
    setLanguage(language: unknown): void

    /**
     * 解析源代码文本，返回语法树
     */
    parse(text: string): Tree
  }
}

declare module "tree-sitter-java" {
  const language: unknown
  export default language
}

declare module "tree-sitter-cpp" {
  const language: unknown
  export default language
}
