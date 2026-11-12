import { spawn } from 'child_process';

export interface RunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** The whole process group is killed when this runs out. */
  timeoutMs: number;
  /** The process group is killed when stdout grows past this. */
  maxOutputBytes: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  outputTooLarge: boolean;
  /** Set when the command could not be started at all. */
  spawnError: Error | null;
}

const MAX_STDERR_BYTES = 64 * 1024;

/**
 * Runs a command with a time limit and an output limit, and kills it for real when either is hit.
 *
 * Vale starts helpers of its own (for AsciiDoc it runs `asciidoctor`). Killing only Vale would leave
 * such a helper running, still holding a CPU, so the command gets its own process group and the
 * whole group is killed. On Windows there are no process groups and only the process itself is killed.
 */
export function runProcess(command: string, args: string[], options: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const useGroup = process.platform !== 'win32';
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputTooLarge = false;
    let spawnError: Error | null = null;
    let finished = false;

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode,
        signal,
        timedOut,
        outputTooLarge,
        spawnError,
      });
    };

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: useGroup,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const killAll = (): void => {
      try {
        if (useGroup && child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // already gone
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killAll();
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (outputTooLarge) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > options.maxOutputBytes) {
        outputTooLarge = true;
        killAll();
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes >= MAX_STDERR_BYTES) return;
      stderrBytes += chunk.length;
      stderrChunks.push(chunk);
    });

    child.on('error', (error) => {
      spawnError = error;
      // A command that never started will not emit "close"
      if (child.pid === undefined) finish(null, null);
    });

    child.on('close', (exitCode, signal) => {
      // Anything the command left behind in its group goes too
      if (timedOut || outputTooLarge) killAll();
      finish(exitCode, signal);
    });
  });
}
