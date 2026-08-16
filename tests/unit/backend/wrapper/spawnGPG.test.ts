/**
 * spawnGPG (src/backend/wrapper/spawnGPG.ts) — argv construction, stdin handling, result contract,
 * cancellation. `child_process.spawn` is replaced by a scripted fake.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSpawn } from "../../../mocks/fake-child-process";

vi.mock("child_process", () => ({ spawn: fakeSpawn.spawn }));

import spawnGPG from "src/backend/wrapper/spawnGPG";

const race = <T>(p: Promise<T>, ms = 50) =>
	Promise.race([p, new Promise<"TIMEOUT">((r) => setTimeout(() => r("TIMEOUT"), ms))]);

beforeEach(() => fakeSpawn.reset());

describe("argv", () => {
	test("--batch comes first, then caller args, then the operation defaultArgs", async () => {
		fakeSpawn.script(() => ({ stdout: "ok" }));
		const { gpgResult } = spawnGPG("gpg", "data", ["--encrypt"], ["--armor", "--recipient", "ABCDEF01"]);
		await gpgResult;
		expect(fakeSpawn.lastCall!.exec).toBe("gpg");
		expect(fakeSpawn.lastCall!.args).toEqual(["--batch", "--armor", "--recipient", "ABCDEF01", "--encrypt"]);
	});

	test("args is optional", async () => {
		fakeSpawn.script(() => ({ stdout: "v" }));
		const { gpgResult } = spawnGPG("/usr/bin/gpg", null, ["--version"]);
		await gpgResult;
		expect(fakeSpawn.lastCall!.args).toEqual(["--batch", "--version"]);
	});
});

describe("stdin", () => {
	test("input is written to stdin and stdin is closed", async () => {
		fakeSpawn.script(() => ({ stdout: "ct", waitForStdinEnd: true }));
		const { gpgResult } = spawnGPG("gpg", "plaintext note", ["--encrypt"]);
		const { result } = await gpgResult;
		expect(result!.toString()).toBe("ct");
		expect(fakeSpawn.lastCall!.process.stdinData).toBe("plaintext note");
		expect(fakeSpawn.lastCall!.process.stdinEnded).toBe(true);
	});

	test("Buffer input is supported", async () => {
		fakeSpawn.script(() => ({ stdout: "ct", waitForStdinEnd: true }));
		const { gpgResult } = spawnGPG("gpg", Buffer.from("bytes"), ["--encrypt"]);
		await gpgResult;
		expect(fakeSpawn.lastCall!.process.stdinData).toBe("bytes");
	});

	test("null input: stdin is left alone (gpg --version style calls)", async () => {
		fakeSpawn.script(() => ({ stdout: "gpg (GnuPG) 2.4.7" }));
		const { gpgResult } = spawnGPG("gpg", null, ["--version"]);
		await gpgResult;
		expect(fakeSpawn.lastCall!.process.stdinData).toBe("");
	});

	// F04 — `if (input)` is falsy for "" so stdin is never ended and gpg blocks forever on an empty note.
	test.fails("[F04] an EMPTY string input still ends stdin (otherwise gpg hangs on empty notes)", async () => {
		fakeSpawn.script(() => ({ stdout: "ct", waitForStdinEnd: true }));
		const { gpgResult } = spawnGPG("gpg", "", ["--encrypt"]);
		expect(await race(gpgResult)).not.toBe("TIMEOUT");
		expect(fakeSpawn.lastCall!.process.stdinEnded).toBe(true);
	});

	// F04 — no "error" listener on stdin: an EPIPE (gpg exited early) becomes an unhandled stream error.
	test.fails("[F04] stdin has an error handler (EPIPE when gpg exits early must not crash the renderer)", async () => {
		fakeSpawn.script(() => ({ stdout: "", code: 2, stderr: "gpg: no valid recipient" }));
		const { gpgResult } = spawnGPG("gpg", "note", ["--encrypt"]);
		const settled = gpgResult.catch(() => undefined); // the non-zero exit rejects; keep it handled
		try {
			expect(fakeSpawn.lastCall!.process.stdin.listenerCount("error")).toBeGreaterThan(0);
		} finally {
			await settled;
		}
	});
});

describe("result contract", () => {
	test("exit 0 resolves with stdout as Buffer and no error", async () => {
		fakeSpawn.script(() => ({ stdout: Buffer.from("out") }));
		const { result, error } = await spawnGPG("gpg", null, ["--version"]).gpgResult;
		expect(Buffer.isBuffer(result)).toBe(true);
		expect(result!.toString()).toBe("out");
		expect(error).toBeUndefined();
	});

	test("exit 0 with stderr output resolves with BOTH result and error (warnings are common in gpg)", async () => {
		fakeSpawn.script(() => ({ stdout: "out", stderr: "gpg: WARNING: unsafe permissions on homedir\n" }));
		const { result, error } = await spawnGPG("gpg", null, ["--version"]).gpgResult;
		expect(result!.toString()).toBe("out");
		expect(error).toBeInstanceOf(Error);
		expect(error!.message).toContain("unsafe permissions");
	});

	test("non-zero exit rejects with the stderr text", async () => {
		fakeSpawn.script(() => ({ stdout: "", stderr: "gpg: decryption failed: No secret key\n", code: 2 }));
		await expect(spawnGPG("gpg", "ct", ["--decrypt"]).gpgResult).rejects.toThrow("No secret key");
	});

	test("non-zero exit without stderr rejects with stdout as message", async () => {
		fakeSpawn.script(() => ({ stdout: "some stdout", code: 1 }));
		await expect(spawnGPG("gpg", null, ["--version"]).gpgResult).rejects.toThrow("some stdout");
	});

	test("spawn error (ENOENT / EACCES) resolves with { error } instead of rejecting", async () => {
		const enoent = Object.assign(new Error("spawn gpg ENOENT"), { code: "ENOENT" });
		fakeSpawn.script(() => ({ error: enoent }));
		const { result, error } = await spawnGPG("nope-gpg", null, ["--version"]).gpgResult;
		expect(result).toBeUndefined();
		expect(error).toBe(enoent);
	});

	test("large stdout is concatenated across chunks", async () => {
		const big = "x".repeat(200_000);
		fakeSpawn.script(() => ({ stdout: big }));
		const { result } = await spawnGPG("gpg", null, ["--version"]).gpgResult;
		expect(result!.length).toBe(big.length);
	});
});

describe("kill()", () => {
	test("sends SIGINT to the child and the pending decrypt settles", async () => {
		fakeSpawn.script(() => ({ hang: true }));
		const { gpgResult, kill } = spawnGPG("gpg", "ct", ["--decrypt"]);
		expect(await race(gpgResult, 20)).toBe("TIMEOUT");
		kill();
		expect(fakeSpawn.lastCall!.process.kill).toHaveBeenCalledWith("SIGINT");
		// close(code=null) → rejects (code !== 0) with empty message; the plugin surfaces it as a Notice
		await expect(gpgResult).rejects.toBeInstanceOf(Error);
	});
});
