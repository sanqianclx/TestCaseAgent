import { spawnSync } from "child_process"
import path from "path"
import fs from "fs"

/** Python运行时脚本所在目录 */
const PYTHON_RUNTIME_DIR = path.resolve("python-runtime")

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
