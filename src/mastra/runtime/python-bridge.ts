import { spawnSync } from "child_process"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const REQUIRED_RUNTIME_FILES = ["parse_source.py", "run_pytest.py", "export_cases.py"]

export interface PythonCallResult<T = unknown> {
  ok: boolean
  data: T | null
  error: { code: string; message: string; details?: unknown } | null
}

function isPythonRuntimeDir(dir: string): boolean {
  try {
    return (
      fs.existsSync(dir) &&
      fs.statSync(dir).isDirectory() &&
      REQUIRED_RUNTIME_FILES.every((file) => fs.existsSync(path.join(dir, file)))
    )
  } catch {
    return false
  }
}

function walkUpForRuntime(startDir: string): string | undefined {
  let dir = path.resolve(startDir)

  while (true) {
    const candidate = path.join(dir, "python-runtime")
    if (isPythonRuntimeDir(candidate)) {
      return candidate
    }

    const parent = path.dirname(dir)
    if (parent === dir) {
      return undefined
    }
    dir = parent
  }
}

function resolvePythonRuntimeDir(): string {
  const explicit = process.env.TESTGENERATE_PYTHON_RUNTIME_DIR || process.env.PYTHON_RUNTIME_DIR
  if (explicit) {
    const resolved = path.resolve(explicit)
    if (isPythonRuntimeDir(resolved)) {
      return resolved
    }
    throw new Error(`PYTHON_RUNTIME_DIR_INVALID: ${resolved}`)
  }

  const anchors = [
    process.cwd(),
    __dirname,
    process.env.INIT_CWD,
    path.dirname(__filename),
  ].filter((item): item is string => Boolean(item))

  for (const anchor of anchors) {
    const found = walkUpForRuntime(anchor)
    if (found) {
      return found
    }
  }

  throw new Error(
    `PYTHON_RUNTIME_DIR_NOT_FOUND: 无法找到 python-runtime 目录，搜索路径：${anchors
      .map((item) => path.resolve(item))
      .join(", ")}`
  )
}

let cachedPythonRuntimeDir: string | undefined

export function getPythonRuntimeDir(): string {
  cachedPythonRuntimeDir ??= resolvePythonRuntimeDir()
  return cachedPythonRuntimeDir
}

export function callPythonScript<T>(
  scriptName: string,
  inputData: Record<string, unknown>,
  timeoutMs = 120_000
): PythonCallResult<T> {
  let pythonRuntimeDir: string
  try {
    pythonRuntimeDir = getPythonRuntimeDir()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      data: null,
      error: { code: "PYTHON_RUNTIME_DIR_NOT_FOUND", message },
    }
  }

  const scriptPath = path.join(pythonRuntimeDir, scriptName)

  if (!fs.existsSync(scriptPath)) {
    return {
      ok: false,
      data: null,
      error: { code: "SCRIPT_NOT_FOUND", message: `找不到 Python 脚本：${scriptPath}` },
    }
  }

  try {
    const output = spawnSync("python", [scriptPath], {
      cwd: pythonRuntimeDir,
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
          message: output.stderr || `Python 脚本退出码为 ${output.status}`,
        },
      }
    }

    try {
      return JSON.parse(output.stdout.trim()) as PythonCallResult<T>
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      data: null,
      error: { code: "PYTHON_BRIDGE_ERROR", message },
    }
  }
}
