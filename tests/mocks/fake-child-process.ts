/**
 * Scripted stand-in for `child_process.spawn` used by src/backend/wrapper/spawnGPG.ts.
 *
 * Usage in a test file (the mock must be hoisted, so it lives in the test file itself):
 *
 *   import { fakeSpawn } from "../../mocks/fake-child-process";
 *   vi.mock("child_process", () => ({ spawn: fakeSpawn.spawn }));
 *   fakeSpawn.script(() => ({ stdout: "gpg (GnuPG) 2.4.7\n" }));
 *
 * Every spawn is recorded in `fakeSpawn.calls` (exec, args, stdin written by the caller).
 */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { vi } from "vitest";

export interface ScriptedProcess {
	/** data emitted on stdout (string or Buffer) */
	stdout?: string | Buffer;
	/** data emitted on stderr */
	stderr?: string;
	/** exit code emitted with "close" (default 0) */
	code?: number | null;
	/** emit a spawn "error" event (e.g. ENOENT) instead of running */
	error?: Error;
	/** wait for the caller to end stdin before emitting stdout/close (like a real gpg reading stdin) */
	waitForStdinEnd?: boolean;
	/** never finish (until kill() is called) — for hang / cancel scenarios */
	hang?: boolean;
	/** ms to wait before producing output */
	delayMs?: number;
}

export class FakeChildProcess extends EventEmitter {
	stdout = new PassThrough();
	stderr = new PassThrough();
	stdin = new PassThrough();
	pid = 4242;
	killed = false;
	exitCode: number | null = null;
	signalCode: NodeJS.Signals | null = null;
	/** everything the caller wrote to stdin */
	stdinData = "";
	stdinEnded = false;
	kill = vi.fn((signal: NodeJS.Signals | number = "SIGTERM") => {
		this.killed = true;
		this.signalCode = typeof signal === "string" ? signal : null;
		queueMicrotask(() => {
			this.stdout.end();
			this.stderr.end();
			this.emit("close", null, this.signalCode);
		});
		return true;
	});

	constructor() {
		super();
		this.stdin.on("data", (chunk: Buffer | string) => {
			this.stdinData += chunk.toString();
		});
		this.stdin.on("finish", () => {
			this.stdinEnded = true;
			this.emit("stdin-ended__");
		});
	}
}

export interface SpawnCall {
	exec: string;
	args: string[];
	process: FakeChildProcess;
}

class FakeSpawnRegistry {
	calls: SpawnCall[] = [];
	private scriptFn: (exec: string, args: string[]) => ScriptedProcess = () => ({ stdout: "" });

	/** Define how the next spawns behave. */
	script(fn: (exec: string, args: string[]) => ScriptedProcess): void {
		this.scriptFn = fn;
	}

	reset(): void {
		this.calls = [];
		this.scriptFn = () => ({ stdout: "" });
	}

	get lastCall(): SpawnCall | undefined {
		return this.calls[this.calls.length - 1];
	}

	spawn = (exec: string, args: string[]): FakeChildProcess => {
		const proc = new FakeChildProcess();
		const script = this.scriptFn(exec, args);
		this.calls.push({ exec, args: [...args], process: proc });

		const run = () => {
			if (script.error) {
				proc.emit("error", script.error);
				return;
			}
			if (script.hang) return; // resolved only via kill()
			const produce = () => {
				if (script.stdout !== undefined && script.stdout !== null && script.stdout.length > 0) {
					proc.stdout.write(script.stdout);
				}
				if (script.stderr) proc.stderr.write(script.stderr);
				proc.stdout.end();
				proc.stderr.end();
				proc.exitCode = script.code ?? 0;
				// let the readable listeners flush before close (real processes behave the same way)
				setImmediate(() => proc.emit("close", proc.exitCode, null));
			};
			if (script.waitForStdinEnd) {
				if (proc.stdinEnded) produce();
				else proc.once("stdin-ended__", produce);
			} else {
				produce();
			}
		};
		if (script.delayMs) setTimeout(run, script.delayMs);
		else setImmediate(run);
		return proc;
	};
}

export const fakeSpawn = new FakeSpawnRegistry();
