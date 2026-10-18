// Shared test plumbing: find Playwright, run named steps, report.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Use a local install if there is one, otherwise the globally installed copy.
export function playwright() {
  const require = createRequire(import.meta.url);
  try { return require("playwright"); } catch (e) { /* fall through */ }
  const globalRoot = execSync("npm root -g").toString().trim();
  return require(join(globalRoot, "playwright"));
}

let failed = 0, passed = 0;

export async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log("PASS  " + name);
  } catch (e) {
    failed++;
    console.log("FAIL  " + name + "\n      " + String(e.message).split("\n")[0]);
  }
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function finish(extra) {
  console.log("\n" + passed + " passed, " + failed + " failed" + (extra ? "  " + extra : ""));
  process.exitCode = failed ? 1 : 0;
}
