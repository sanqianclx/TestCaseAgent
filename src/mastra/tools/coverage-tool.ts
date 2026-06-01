import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import fs from "fs"
import path from "path"
import { spawnSync } from "child_process"
import { callPythonScript } from "../runtime/python-bridge.js"

// ============================================================
// 覆盖率核心类型
// ============================================================

/**
 * 单文件覆盖率详情
 */
export interface FileCoverage {
  /** 行覆盖率百分比（0~100） */
  line_rate: number
  /** 已覆盖行数 */
  covered_lines: number
  /** 总可执行行数 */
  total_lines: number
  /** 未覆盖行数 */
  missing_lines: number
  /** 分支覆盖率百分比 */
  branch_rate: number
}

/**
 * 统一覆盖率结果 —— 三语共用
 */
export interface UnifiedCoverageResult {
  /** 是否成功获取覆盖率数据 */
  ok: boolean
  /** 失败时的错误信息 */
  error?: { code: string; message: string }
  /** 行覆盖率百分比（0~100） */
  line_rate: number
  /** 分支覆盖率百分比 */
  branch_rate: number
  /** 已覆盖行数 */
  covered_lines: number
  /** 总可执行行数 */
  total_lines: number
  /** 未覆盖行数 */
  missing_lines: number
  /** 排除行数 */
  excluded_lines: number
  /** 逐文件覆盖率 */
  per_file: Record<string, FileCoverage>
  /** 覆盖率工具名称 */
  tool: string
  /** 执行耗时（毫秒） */
  duration_ms: number
}

/**
 * 覆盖率工具选择
 */
export type CoverageTool = "python" | "java" | "cpp"

// ============================================================
// Python 覆盖率：coverage.py
// ============================================================

function runPythonCoverage(input: {
  test_code: string
  source_code: string
  filename: string
  timeout?: number
}): UnifiedCoverageResult {
  const result = callPythonScript<{
    line_rate: number
    branch_rate: number
    covered_lines: number
    total_lines: number
    missing_lines: number
    excluded_lines: number
    per_file: Record<string, FileCoverage>
    duration_ms: number
  }>("coverage_runner.py", input, (input.timeout ?? 60) * 1000 + 10_000)

  if (!result.ok || !result.data) {
    return {
      ok: false,
      error: { code: result.error?.code ?? "UNKNOWN", message: result.error?.message ?? "未知错误" },
      line_rate: 0,
      branch_rate: 0,
      covered_lines: 0,
      total_lines: 0,
      missing_lines: 0,
      excluded_lines: 0,
      per_file: {},
      tool: "coverage.py",
      duration_ms: 0,
    }
  }

  return {
    ok: true,
    line_rate: result.data.line_rate,
    branch_rate: result.data.branch_rate,
    covered_lines: result.data.covered_lines,
    total_lines: result.data.total_lines,
    missing_lines: result.data.missing_lines,
    excluded_lines: result.data.excluded_lines,
    per_file: result.data.per_file,
    tool: "coverage.py",
    duration_ms: result.data.duration_ms,
  }
}

// ============================================================
// Java 覆盖率：JaCoCo
// ============================================================

/**
 * 解析 JaCoCo 生成的 jacoco.xml，提取行覆盖率指标
 *
 * jacoco.xml 结构示例：
 * <report name="...">
 *   <counter type="LINE" missed="10" covered="90"/>
 *   <counter type="BRANCH" missed="5" covered="45"/>
 *   <package name="...">
 *     <sourcefile name="Calc.java">
 *       <counter type="LINE" missed="2" covered="18"/>
 *     </sourcefile>
 *   </package>
 * </report>
 */
function runJavaCoverage(cwd: string): UnifiedCoverageResult {
  const start = Date.now()
  const jacocoPath = path.join(cwd, "target", "site", "jacoco", "jacoco.xml")

  // 第一次读失败,先尝试抢救一次:让 maven 重新生成报告
  if (!fs.existsSync(jacocoPath)) {
    const recovered = attemptJacocoReportGeneration(cwd)
    if (!recovered) {
      return buildJavaNotFoundResult(jacocoPath, cwd, start)
    }
  }

  try {
    const xml = fs.readFileSync(jacocoPath, "utf-8")

    // 解析顶层 counter 标签
    const lineCounter = extractXmlCounter(xml, "LINE")
    const branchCounter = extractXmlCounter(xml, "BRANCH")

    const covered = lineCounter.covered
    const missed = lineCounter.missed
    const total = covered + missed
    const lineRate = total > 0 ? Math.round((covered / total) * 100 * 100) / 100 : 0
    const branchCovered = branchCounter.covered
    const branchMissed = branchCounter.missed
    const branchTotal = branchCovered + branchMissed
    const branchRate = branchTotal > 0 ? Math.round((branchCovered / branchTotal) * 100 * 100) / 100 : 0

    // 解析逐文件覆盖率
    const perFile: Record<string, FileCoverage> = {}
    const fileRegex = /<sourcefile name="([^"]+)">([\s\S]*?)<\/sourcefile>/g
    let fileMatch: RegExpExecArray | null
    while ((fileMatch = fileRegex.exec(xml)) !== null) {
      const fileName = fileMatch[1]
      const block = fileMatch[2]
      const fl = extractXmlCounter(block, "LINE")
      const fb = extractXmlCounter(block, "BRANCH")
      const ft = fl.covered + fl.missed
      const fbt = fb.covered + fb.missed
      perFile[fileName] = {
        line_rate: ft > 0 ? Math.round((fl.covered / ft) * 100 * 100) / 100 : 0,
        covered_lines: fl.covered,
        total_lines: ft,
        missing_lines: fl.missed,
        // 优先取逐文件 BRANCH counter;若该文件无分支信息(0 covered + 0 missed),
        // 退化为使用 LINE 覆盖率(对应"此文件无可测分支"的语义)
        branch_rate: fbt > 0 ? Math.round((fb.covered / fbt) * 100 * 100) / 100 : (ft > 0 ? Math.round((fl.covered / ft) * 100 * 100) / 100 : 0),
      }
    }

    return {
      ok: true,
      line_rate: lineRate,
      branch_rate: branchRate,
      covered_lines: covered,
      total_lines: total,
      missing_lines: missed,
      excluded_lines: 0,
      per_file: perFile,
      tool: "JaCoCo",
      duration_ms: Date.now() - start,
    }
  } catch (error) {
    return {
      ok: false,
      error: { code: "JACOCO_PARSE_ERROR", message: `解析 jacoco.xml 失败：${String(error)}` },
      line_rate: 0, branch_rate: 0, covered_lines: 0, total_lines: 0,
      missing_lines: 0, excluded_lines: 0, per_file: {}, tool: "JaCoCo",
      duration_ms: Date.now() - start,
    }
  }
}

/**
 * 最后抢救:jacoco.xml 不在时尝试主动调用 `mvn jacoco:report` 重新生成
 *
 * 触发场景:java-adapter 跑完 verify 后 xml 仍缺失(可能是 prepare-agent 没绑到
 * initialize 阶段、Surefire 未运行、或者 Maven 报 no data)。
 *
 * @returns true 表示抢救成功(xml 出现),false 表示放弃
 */
function attemptJacocoReportGeneration(cwd: string): boolean {
  const execPath = path.join(cwd, "target", "jacoco.exec")
  const pomPath = path.join(cwd, "pom.xml")
  if (!fs.existsSync(pomPath) || !fs.existsSync(execPath)) {
    return false
  }
  const maven = resolveMavenForCoverage()
  if (!maven) return false

  try {
    const result = spawnSync(maven, ["jacoco:report", "-Djacoco.skip=false"], {
      cwd,
      encoding: "utf-8",
      timeout: 60_000,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      shell: process.platform === "win32" && /\.cmd$/i.test(maven),
    })
    if (result.error || result.status !== 0) return false
    return fs.existsSync(path.join(cwd, "target", "site", "jacoco", "jacoco.xml"))
  } catch {
    return false
  }
}

/**
 * 构建"找不到 jacoco.xml"的标准失败结果,并附带诊断线索
 *
 * 通过检查 cwd 下的关键文件,告诉用户下一步该排查什么:
 * - 缺 pom.xml:说明 java-adapter 没正常跑测试,先去查 mvn
 * - 缺 jacoco.exec:说明 jacoco agent 没启动(可能 surefire 跳过了)
 * - 都没问题但 xml 缺失:说明 report goal 没跑
 */
function buildJavaNotFoundResult(jacocoPath: string, cwd: string, start: number): UnifiedCoverageResult {
  const hasPom = fs.existsSync(path.join(cwd, "pom.xml"))
  const hasExec = fs.existsSync(path.join(cwd, "target", "jacoco.exec"))
  const hasSurefireReports = fs.existsSync(path.join(cwd, "target", "surefire-reports"))
  const hints: string[] = []
  if (!hasPom) hints.push("临时目录中无 pom.xml —— java-adapter 可能未正常创建工程")
  if (!hasExec) hints.push("target/jacoco.exec 不存在 —— jacoco agent 未启动(可能 surefire 跳过或 jacoco-maven-plugin 缺失)")
  if (hasExec && !hasSurefireReports) hints.push("target/surefire-reports 缺失 —— Surefire 阶段未运行(可能 Maven 编译失败)")
  if (hints.length === 0) hints.push("jacoco.exec 存在但 jacoco.xml 缺失 —— `report` goal 未在 verify 阶段触发")
  return {
    ok: false,
    error: { code: "JACOCO_XML_NOT_FOUND", message: `未找到 jacoco.xml（路径：${jacocoPath}）。诊断：${hints.join("; ")}` },
    line_rate: 0, branch_rate: 0, covered_lines: 0, total_lines: 0,
    missing_lines: 0, excluded_lines: 0, per_file: {}, tool: "JaCoCo",
    duration_ms: Date.now() - start,
  }
}

/**
 * 解析 mvn 命令,优先 mvn,fallback 到 MAVEN_HOME/M2_HOME 下的 mvn.cmd
 *
 * 仅用于 coverage 抢救场景,不与 java-adapter 的解析重复(避免互相耦合)
 */
function resolveMavenForCoverage(): string | undefined {
  const candidates = [
    "mvn",
    process.env.MAVEN_HOME ? path.join(process.env.MAVEN_HOME, "bin", process.platform === "win32" ? "mvn.cmd" : "mvn") : undefined,
    process.env.M2_HOME ? path.join(process.env.M2_HOME, "bin", process.platform === "win32" ? "mvn.cmd" : "mvn") : undefined,
  ].filter((item): item is string => Boolean(item))
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf-8", windowsHide: true, shell: process.platform === "win32" && /\.cmd$/i.test(candidate) })
    if (!probe.error && probe.status === 0) return candidate
  }
  return undefined
}

/**
 * 从 JaCoCo XML 中提取指定类型的 counter,取所有匹配中 covered+missed 最大的那一个
 *
 * JaCoCo XML 里同一类型的 counter 会在多处出现:
 * - sourcefile 节点下(每个源文件一份)
 * - package 节点下(每个包一份)
 * - 顶层 report 节点下(工程总和)
 *
 * 工程总和一定最大(等于所有子节点之和),所以"取最大"等价于"取顶层 report 节点"。
 * 之前的实现只用 `regex.exec` 取第一个匹配,会先抓到某个 sourcefile 的局部 counter,
 * 当该文件未被 Surefire 触达时 covered=0,导致顶层 line_rate 被错误算成 0%。
 */
function extractXmlCounter(xml: string, type: string): { covered: number; missed: number } {
  const regex = new RegExp(`<counter type="${type}"\\s+missed="(\\d+)"\\s+covered="(\\d+)"`, "g")
  let bestCovered = 0
  let bestMissed = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(xml)) !== null) {
    const missed = Number(match[1])
    const covered = Number(match[2])
    if (covered + missed > bestCovered + bestMissed) {
      bestCovered = covered
      bestMissed = missed
    }
  }
  return { covered: bestCovered, missed: bestMissed }
}

// ============================================================
// C++ 覆盖率：gcov / OpenCppCoverage（预留）
// ============================================================

/**
 * TODO: C++ 覆盖率接入 —— gcov（Linux） 或 OpenCppCoverage（Windows）
 *
 * Linux 实现思路（gcov + lcov）：
 * 1. g++ --coverage -o test_binary source.cpp test.cpp
 * 2. 执行 test_binary
 * 3. lcov --capture --directory . --output-file coverage.info
 * 4. lcov --summary coverage.info
 * 5. 解析覆盖率摘要，提取 line rate
 *
 * Windows 实现思路（OpenCppCoverage）：
 * 1. 安装 OpenCppCoverage
 * 2. OpenCppCoverage --sources <source_dir> --export_type cobertura:coverage.xml -- <exe>
 * 3. 解析 coverage.xml，提取行覆盖率
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _cppCoverageStub(_input: {
  test_code: string
  source_code: string
  source_file: string
}): UnifiedCoverageResult {
  return {
    ok: false,
    error: { code: "NOT_IMPLEMENTED", message: "C++ 覆盖率（gcov/OpenCppCoverage）尚未接入，敬请期待" },
    line_rate: 0,
    branch_rate: 0,
    covered_lines: 0,
    total_lines: 0,
    missing_lines: 0,
    excluded_lines: 0,
    per_file: {},
    tool: "gcov（预留）",
    duration_ms: 0,
  }
}

// ============================================================
// 统一覆盖率入口
// ============================================================

/**
 * 根据语言执行对应的覆盖率工具并返回统一结果
 *
 * @param inputData.test_code - 完整的测试代码
 * @param inputData.source_code - 完整的被测源码
 * @param inputData.filename - 源文件名
 * @param inputData.language - 语言（python/java/cpp）
 * @param inputData.source_file - 源文件路径（Java/C++ 需要）
 * @param inputData.timeout - 超时秒数
 */
export function measureCoverage(inputData: {
  test_code: string
  source_code: string
  filename: string
  language: string
  source_file?: string
  timeout?: number
  /** Java/C++ 的临时执行目录（Maven/g++ 编译测试的地方） */
  cwd?: string
}): UnifiedCoverageResult {
  const language = (inputData.language ?? "python").toLowerCase()

  if (language === "python" || language === "py") {
    return runPythonCoverage({
      test_code: inputData.test_code,
      source_code: inputData.source_code,
      filename: inputData.filename,
      timeout: inputData.timeout,
    })
  }

  if (language === "java") {
    if (inputData.cwd) {
      return runJavaCoverage(inputData.cwd)
    }
    return {
      ok: false,
      error: { code: "MISSING_CWD", message: "Java 覆盖率需要提供 cwd（Maven 执行目录）参数" },
      line_rate: 0, branch_rate: 0, covered_lines: 0, total_lines: 0,
      missing_lines: 0, excluded_lines: 0, per_file: {}, tool: "JaCoCo",
      duration_ms: 0,
    }
  }

  if (language === "cpp" || language === "c++") {
    return _cppCoverageStub({
      test_code: inputData.test_code,
      source_code: inputData.source_code,
      source_file: inputData.source_file ?? inputData.filename,
    })
  }

  return {
    ok: false,
    error: { code: "UNSUPPORTED_LANGUAGE", message: `不支持的语言: ${language}` },
    line_rate: 0,
    branch_rate: 0,
    covered_lines: 0,
    total_lines: 0,
    missing_lines: 0,
    excluded_lines: 0,
    per_file: {},
    tool: "unknown",
    duration_ms: 0,
  }
}

// ============================================================
// Mastra Tool 注册
// ============================================================

export const measureCoverageTool = createTool({
  id: "measure-coverage",
  description:
    "对已生成的测试代码执行真实的代码行覆盖率测量。Python 使用 coverage.py，Java 和 C++ 预留。" +
    "在 execute-tests 通过后调用此工具，可获取行覆盖率、分支覆盖率和逐文件覆盖详情。" +
    "与质量检查工具互补：quality-check 检查断言质量，measure-coverage 检查代码覆盖广度。",
  inputSchema: z.object({
    test_code: z.string().describe("完整的测试代码内容"),
    source_code: z.string().describe("完整的被测源代码内容"),
    filename: z.string().describe("源文件名（如 user_service.py），用于保持导入模块名"),
    language: z.enum(["python", "java", "cpp"]).describe("语言标识"),
    source_file: z.string().optional().describe("源文件完整路径（Java/C++ 需要）"),
    timeout: z.number().default(60).describe("覆盖率执行超时秒数"),
    cwd: z.string().optional().describe("Java/C++ 的临时执行目录（Maven/g++ 编译测试的地方）"),
  }),
  outputSchema: z.object({
    ok: z.boolean().describe("是否成功获取覆盖率"),
    error: z.object({ code: z.string(), message: z.string() }).optional(),
    line_rate: z.number().describe("行覆盖率百分比"),
    branch_rate: z.number().describe("分支覆盖率百分比"),
    covered_lines: z.number().describe("已覆盖行数"),
    total_lines: z.number().describe("总可执行行数"),
    per_file: z.record(z.any()).describe("逐文件覆盖率详情"),
    tool: z.string().describe("使用的覆盖率工具名称"),
    duration_ms: z.number().describe("耗时（毫秒）"),
  }),
  execute: async (inputData) => {
    return measureCoverage(inputData)
  },
})
