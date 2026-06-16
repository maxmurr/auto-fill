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
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on("data", (d) => out.push(d));
    proc.stderr.on("data", (d) => err.push(d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      const stdout = Buffer.concat(out).toString();
      if (code === 0) return resolve(stdout);
      const stderr = Buffer.concat(err).toString();
      reject(new Error(`${script} exited ${code}: ${stderr || stdout}`));
    });
  });
}

/** Canonical per-job directory path under the OS temp dir (does not create it). */
export function jobDirPath(id: string): string {
  return path.join(os.tmpdir(), "autofill", id);
}

/** Per-job working directory under the OS temp dir (created if missing). */
export async function jobDir(id: string): Promise<string> {
  const dir = jobDirPath(id);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
