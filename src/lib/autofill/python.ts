import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

const PY = process.env.PYTHON_BIN || "python3";
const SCRIPTS = path.join(process.cwd(), "pyscripts");

/** Run a vendored python script, resolving with stdout (rejects on non-zero exit). */
export function runPy(script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PY, [path.join(SCRIPTS, script), ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`${script} exited ${code}: ${err || out}`)),
    );
  });
}

/** Per-job working directory under the OS temp dir. */
export async function jobDir(id: string): Promise<string> {
  const dir = path.join(os.tmpdir(), "autofill", id);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
