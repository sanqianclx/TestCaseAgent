import { spawnSync } from "child_process"
import path from "path"
import { fileURLToPath } from "url"

import fs from "fs"

/** 当前模块的文件路径，用于向上搜索python-runtime目录 */
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * 从指定目录向上逐级搜索python-runtime目录
 * 编译产物（.mastra/output/）与源文件（src/mastra/runtime/）目录层级不同，
 * 硬编码相对层级不可靠。此函数向上遍历直到找到python-runtime目录或到达文件系统根目录。
 *
 * @param startDir - 起始搜索目录
 * @returns python-runtime目录的绝对路径
 * @throws 若遍历到文件系统根目录仍未找到则抛出错误
 */
function findPythonRuntimeDir(startDir: string): string {
  let dir = startDir
  while (true) {
    const candidate = path.join(dir, "python-runtime")
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error("无法找到python-runtime目录，请确认项目结构完整")
    }
    dir = parent
  }
}

/** Python运行时脚本所在目录（向上搜索避免编译产物路径差异） */
const PYTHON_RUNTIME_DIR = findPythonRuntimeDir(__dirname)

export interface PythonCallResult<T = unknown> {
  ok: boolean
  data: T | null
  error: { code: string; message: string; details?: unknown } | null
}

/**
 * TypeScript与Python运行时的统一桥接函数
 * 通过Node.js子进程（spawnSync）调用python-runtime目录下的Python脚本，
 * 将输入数据通过stdin以UTF-8 JSON格式传入，读取stdout的JSON输出。
 * 全部使用stdin/stdout通信，避免命令行参数传中文导致的编码乱码问题。
 *
 * @param scriptName - Python脚本文件名（如"parse_source.py"）
 * @param inputData - 传给Python脚本的JSON-serializable键值对
 * @param timeoutMs - 子进程超时毫秒数，默认120秒
 * @returns 统一的 { ok, data, error } 结果结构
 */
export function callPythonScript<T>(
  scriptName: string,
  inputData: Record<string, unknown>,
  timeoutMs = 120_000
): PythonCallResult<T> {
  const scriptPath = path.join(PYTHON_RUNTIME_DIR, scriptName)

  if (!fs.existsSync(scriptPath)) {
    return {
      ok: false,
      data: null,
      error: { code: "SCRIPT_NOT_FOUND", message: `Python脚本不存在: ${scriptPath}` },
    }
  }

  try {
    const output = spawnSync("python", [scriptPath], {
      cwd: PYTHON_RUNTIME_DIR,
      input: JSON.stringify(inputData),
      encoding: "utf-8",
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    })

    /* spawn失败（如python未安装） */
    if (output.error) {
      return {
        ok: false,
        data: null,
        error: { code: "PYTHON_BRIDGE_ERROR", message: output.error.message },
      }
    }

    /* Python脚本非零退出（语法错误/运行时异常等） */
    if (output.status !== 0) {
      return {
        ok: false,
        data: null,
        error: {
          code: "PYTHON_RUNTIME_ERROR",
          message: output.stderr || `Python脚本退出码: ${output.status}`,
        },
      }
    }

    /* 解析Python返回的JSON */
    try {
      return JSON.parse(output.stdout.trim()) as PythonCallResult<T>
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        data: null,
        error: {
          code: "PYTHON_BRIDGE_INVALID_JSON",
          message,
          details: { stdout: output.stdout, stderr: output.stderr },
        },
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      data: null,
      error: { code: "PYTHON_BRIDGE_ERROR", message },
    }
  }
}
