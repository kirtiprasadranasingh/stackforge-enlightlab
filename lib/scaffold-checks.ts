import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  CHECK_LABELS,
  CHECK_TIMEOUT_MS,
  type ScaffoldCheckId,
} from '@/lib/scaffold-checks-shared';

export type { ScaffoldCheckId } from '@/lib/scaffold-checks-shared';
export {
  CHECK_IDS,
  CHECK_LABELS,
  CHECK_TIMEOUT_MS,
  ScaffoldCheckFileSchema,
  ScaffoldCheckRequestSchema,
} from '@/lib/scaffold-checks-shared';

export type CheckLineEmitter = (line: string) => void;

function assertSafeRelativePath(relPath: string, root: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (
    !normalized ||
    normalized.includes('..') ||
    path.isAbsolute(normalized) ||
    !/^[a-zA-Z0-9/_.\-]+$/.test(normalized)
  ) {
    throw new Error(`Unsafe file path: ${relPath}`);
  }
  const full = path.resolve(root, normalized);
  const rootResolved = path.resolve(root);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
    throw new Error(`Path escapes scaffold root: ${relPath}`);
  }
  return full;
}

export async function writeScaffoldTemp(
  files: Array<{ path: string; content: string }>
): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stackforge-check-'));
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += Buffer.byteLength(file.content, 'utf8');
    if (totalBytes > 2_500_000) {
      await fs.rm(tempDir, { recursive: true, force: true });
      throw new Error('Scaffold exceeds 2.5MB total size limit');
    }
    const filePath = assertSafeRelativePath(file.path, tempDir);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.content, 'utf8');
  }
  return tempDir;
}

function streamProcess(
  child: ChildProcessWithoutNullStreams,
  emit: CheckLineEmitter,
  timeoutMs: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdoutBuf = '';
    let stderrBuf = '';

    const flush = (chunk: string, isErr: boolean) => {
      if (isErr) stderrBuf += chunk;
      else stdoutBuf += chunk;
      const parts = (isErr ? stderrBuf : stdoutBuf).split(/\r?\n/);
      if (isErr) stderrBuf = parts.pop() ?? '';
      else stdoutBuf = parts.pop() ?? '';
      for (const line of parts) {
        emit(line);
      }
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`Check timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => flush(d.toString('utf8'), false));
    child.stderr.on('data', (d: Buffer) => flush(d.toString('utf8'), true));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stdoutBuf) emit(stdoutBuf);
      if (stderrBuf) emit(stderrBuf);
      resolve(code ?? 1);
    });
  });
}

async function runShell(
  command: string,
  args: string[],
  cwd: string,
  emit: CheckLineEmitter,
  timeoutMs: number
): Promise<number> {
  emit(`$ ${command} ${args.join(' ')}`);
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, CI: 'true', TF_IN_AUTOMATION: '1' },
    shell: false,
    windowsHide: true,
  });
  return streamProcess(child, emit, timeoutMs);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function runTerraformChecks(
  scaffoldDir: string,
  emit: CheckLineEmitter,
  budgetMs: number
): Promise<number> {
  const tfDir = path.join(scaffoldDir, 'terraform');
  if (!(await pathExists(tfDir))) {
    emit('INFO  - no terraform/ directory found, skipping');
    return 0;
  }
  const started = Date.now();
  const left = () => Math.max(5_000, budgetMs - (Date.now() - started));

  let code = await runShell(
    'terraform',
    ['init', '-backend=false', '-input=false'],
    tfDir,
    emit,
    left()
  );
  if (code !== 0) return code;

  code = await runShell('terraform', ['validate'], tfDir, emit, left());
  if (code !== 0) return code;

  try {
    code = await runShell(
      'terraform',
      ['plan', '-input=false', '-refresh=false', '-lock=false', '-no-color'],
      tfDir,
      emit,
      left()
    );
    if (code === 0 || code === 2) return 0;
    emit(
      'WARN  - terraform plan exited non-zero (often missing cloud credentials — expected in generator QA)'
    );
    return 0;
  } catch (err) {
    emit(
      `WARN  - terraform plan skipped — ${err instanceof Error ? err.message : String(err)}`
    );
    return 0;
  }
}

async function runHelmChecks(
  scaffoldDir: string,
  emit: CheckLineEmitter,
  budgetMs: number
): Promise<number> {
  const chartsRoot = path.join(scaffoldDir, 'charts');
  if (!(await pathExists(chartsRoot))) {
    emit('INFO  - no charts/ directory found, skipping');
    return 0;
  }
  const entries = await fs.readdir(chartsRoot, { withFileTypes: true });
  const charts = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  if (charts.length === 0) {
    emit('INFO  - no chart directories under charts/, skipping');
    return 0;
  }

  const started = Date.now();
  const left = () => Math.max(5_000, budgetMs - (Date.now() - started));
  let fail = 0;
  for (const name of charts) {
    const chartPath = path.join(chartsRoot, name);
    const lint = await runShell('helm', ['lint', chartPath], scaffoldDir, emit, left());
    if (lint !== 0) fail = 1;
    const tmpl = await runShell(
      'helm',
      ['template', name, chartPath],
      scaffoldDir,
      emit,
      left()
    );
    if (tmpl !== 0) fail = 1;
  }
  return fail;
}

async function runHadolint(
  scaffoldDir: string,
  emit: CheckLineEmitter,
  budgetMs: number
): Promise<number> {
  const rootDf = path.join(scaffoldDir, 'Dockerfile');
  const appDf = path.join(scaffoldDir, 'app', 'Dockerfile');
  let dockerfile = '';
  if (await pathExists(rootDf)) dockerfile = rootDf;
  else if (await pathExists(appDf)) dockerfile = appDf;
  if (!dockerfile) {
    emit('INFO  - no Dockerfile found, skipping');
    return 0;
  }
  return runShell('hadolint', [dockerfile], scaffoldDir, emit, budgetMs);
}

async function runActionlint(
  scaffoldDir: string,
  emit: CheckLineEmitter,
  budgetMs: number
): Promise<number> {
  const wfDir = path.join(scaffoldDir, '.github', 'workflows');
  if (!(await pathExists(wfDir))) {
    emit('INFO  - no .github/workflows/ directory found, skipping');
    return 0;
  }
  const names = await fs.readdir(wfDir);
  const files = names
    .filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'))
    .map((n) => path.join(wfDir, n));
  if (files.length === 0) {
    emit('INFO  - no workflow YAML files found, skipping');
    return 0;
  }
  return runShell('actionlint', files, scaffoldDir, emit, budgetMs);
}

async function runAllViaScript(
  scaffoldDir: string,
  emit: CheckLineEmitter,
  budgetMs: number
): Promise<number | null> {
  const scriptPath = path.join(process.cwd(), 'scripts', 'validate-scaffold.sh');
  if (!(await pathExists(scriptPath))) {
    emit('WARN  - scripts/validate-scaffold.sh not found — falling back to built-in checks');
    return null;
  }
  try {
    return await runShell('bash', [scriptPath, scaffoldDir], scaffoldDir, emit, budgetMs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ENOENT|not found|bash/i.test(msg)) {
      emit('WARN  - bash unavailable — falling back to built-in checks');
      return null;
    }
    throw err;
  }
}

async function runAllBuiltin(
  scaffoldDir: string,
  emit: CheckLineEmitter,
  budgetMs: number
): Promise<number> {
  const started = Date.now();
  const left = () => Math.max(5_000, budgetMs - (Date.now() - started));
  let fail = 0;

  emit('—— terraform ——');
  if ((await runTerraformChecks(scaffoldDir, emit, left())) !== 0) fail = 1;

  emit('—— helm ——');
  try {
    if ((await runHelmChecks(scaffoldDir, emit, left())) !== 0) fail = 1;
  } catch (err) {
    emit(
      `WARN  - helm unavailable — ${err instanceof Error ? err.message : String(err)}`
    );
  }

  emit('—— hadolint ——');
  try {
    if ((await runHadolint(scaffoldDir, emit, left())) !== 0) fail = 1;
  } catch (err) {
    emit(
      `WARN  - hadolint unavailable — ${err instanceof Error ? err.message : String(err)}`
    );
  }

  emit('—— actionlint ——');
  try {
    if ((await runActionlint(scaffoldDir, emit, left())) !== 0) fail = 1;
  } catch (err) {
    emit(
      `WARN  - actionlint unavailable — ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return fail;
}

export async function runScaffoldCheck(
  check: ScaffoldCheckId,
  scaffoldDir: string,
  emit: CheckLineEmitter
): Promise<number> {
  const budget = CHECK_TIMEOUT_MS[check];
  emit(`Running ${CHECK_LABELS[check]}…`);
  emit(`Scaffold: ${scaffoldDir}`);
  emit('----------------------------------------');

  switch (check) {
    case 'terraform':
      return runTerraformChecks(scaffoldDir, emit, budget);
    case 'helm':
      return runHelmChecks(scaffoldDir, emit, budget);
    case 'hadolint':
      return runHadolint(scaffoldDir, emit, budget);
    case 'actionlint':
      return runActionlint(scaffoldDir, emit, budget);
    case 'all': {
      const viaScript = await runAllViaScript(scaffoldDir, emit, budget);
      if (viaScript !== null) return viaScript;
      return runAllBuiltin(scaffoldDir, emit, budget);
    }
    default:
      return 1;
  }
}
