import { spawnSync } from "child_process"
import path from "path"
import fs from "fs"

const PYTHON_RUNTIME_DIR = path.resolve("python-runtime")

export interface PythonCallResult<T = unknown> {
  ok: boolean
  data: T | null
  error: { code: string; message: string; details?: unknown } | null
}

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

    if (output.error) {
      return {
        ok: false,
        data: null,
        error: { code: "PYTHON_BRIDGE_ERROR", message: output.error.message },
      }
    }

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
