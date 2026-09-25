import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const html = await readFile(join(projectRoot, "index.html"), "utf8");
const inlineModule = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .find(match => /\btype=["']module["']/i.test(match[1]));
if (!inlineModule) throw new Error("index.html has no inline module script");

const taskModules = resolve(projectRoot, "src");
let script = inlineModule[2].replace(/(["'])\/src\/([^"']+)\1/g, (_match, quote, modulePath) => {
  const target = modulePath === "fractional-indexing.js"
    ? resolve(projectRoot, "node_modules/fractional-indexing/src/index.js")
    : resolve(taskModules, modulePath);
  return `${quote}${target}${quote}`;
});

const temporaryDirectory = await mkdtemp(join(tmpdir(), "keydo-inline-check-"));
const sourcePath = join(temporaryDirectory, "inline-module.js");
try {
  await writeFile(sourcePath, script);
  const compiler = Bun.spawn([
    "bunx", "tsc", "--ignoreConfig", "--noEmit", "--allowJs", "--checkJs", "--noImplicitAny", "false",
    "--strictNullChecks", "false", "--skipLibCheck", "--target", "ES2022", "--module", "ESNext",
    "--moduleResolution", "bundler", "--lib", "DOM,DOM.Iterable,ES2022", sourcePath
  ], { cwd: projectRoot, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(compiler.stdout).text(),
    new Response(compiler.stderr).text(),
    compiler.exited
  ]);
  const output = `${stdout}\n${stderr}`;
  const unresolvedNames = output.match(/error TS(?:2304|2552|2503|2307):[^\r\n]*/g) ?? [];
  const compilerProducedDiagnostics = /inline-module\.js\(\d+,\d+\): error TS\d+:/.test(output);
  if (unresolvedNames.length) {
    unresolvedNames.forEach(diagnostic => console.error(diagnostic));
    process.exitCode = 1;
  } else if (exitCode === 0 || compilerProducedDiagnostics) {
    console.log("No unresolved identifiers in inline module");
  } else {
    console.error(output.trim() || "Inline module checker failed without diagnostics");
    process.exitCode = exitCode || 1;
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
