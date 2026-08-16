/**
 * BackendWrapper (src/backend/wrapper/BackendWrapper.ts) — the GnuPG CLI wrapper: executable path checks,
 * `isGPG` status mapping, `--with-colons` key listing and encrypt / decrypt plumbing over spawnGPG.
 * `child_process.spawn` is replaced by the scripted fake, so no real gpg is involved here (see
 * BackendWrapper.gpg.test.ts for the real-binary run).
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSpawn } from "../../../mocks/fake-child-process";

vi.mock("child_process", () => ({ spawn: fakeSpawn.spawn }));

import { BackendWrapper, CliPathStatus, GPGStatusMessage } from "src/backend/wrapper/BackendWrapper";
import { GPG_LIST_KEYS_COLONS, KEYS } from "../../../helpers/fixtures";

const VERSION_OUTPUT = "gpg (GnuPG) 2.4.7\nlibgcrypt 1.10.3\n";
const spawnError = (code: string) => Object.assign(new Error(`spawn gpg ${code}`), { code });

beforeEach(() => fakeSpawn.reset());

describe("executable", () => {
	test("defaults to \"gpg\" and can be changed", () => {
		const w = new BackendWrapper();
		expect(w.getExecutable()).toBe("gpg");
		w.setExecutable("/opt/homebrew/bin/gpg");
		expect(w.getExecutable()).toBe("/opt/homebrew/bin/gpg");
	});

	test("setExecutable does not validate (checkPath is separate)", () => {
		const w = new BackendWrapper();
		w.setExecutable("not-gpg-at-all");
		expect(w.getExecutable()).toBe("not-gpg-at-all");
	});
});

describe("checkPath", () => {
	const w = new BackendWrapper();

	test.each([
		"gpg",
		"/usr/bin/gpg",
		"gpg.exe",
		"gpg2",
		"gpg2.exe",
		"/usr/local/bin/gpg2",
		"C:\\Program Files\\GnuPG\\bin\\gpg.exe",
		"C:\\Program Files (x86)\\GnuPG\\bin\\gpg2.exe",
	])("accepts %s", (p) => {
		expect(w.checkPath(p)).toBe(true);
	});

	test("trims surrounding whitespace before checking", () => {
		expect(w.checkPath("  gpg  ")).toBe(true);
		expect(w.checkPath("\t/usr/bin/gpg\n")).toBe(true);
	});

	test.each([
		["gpg-agent", "another GnuPG binary"],
		["", "empty"],
		["   ", "whitespace only"],
		["/usr/bin/gpgv", "gpgv (verify-only)"],
		["/usr/bin/gpgsm", "gpgsm"],
		["gpgconf", "gpgconf"],
		["/usr/bin/gpg --version", "argument smuggling"],
		["gpg.exe.bak", "backup file"],
	])("rejects %j (%s)", (p) => {
		expect(w.checkPath(p)).toBe(false);
	});

	// F18: the check is case-sensitive; Windows paths are case-insensitive so "GPG.EXE" is a valid gpg.
	test.fails("[F18] accepts \"GPG.EXE\" (case-insensitive executable names on Windows)", () => {
		expect(w.checkPath("GPG.EXE")).toBe(true);
	});

	test.fails("[F18] accepts \"C:\\\\Tools\\\\Gpg.exe\" (mixed case)", () => {
		expect(w.checkPath("C:\\Tools\\Gpg.exe")).toBe(true);
	});
});

describe("isGPG", () => {
	test("NO_GPG_IN_PATH for a bad suffix — without spawning anything", async () => {
		const w = new BackendWrapper();
		expect(await w.isGPG("/usr/bin/gpg-agent")).toBe(CliPathStatus.NO_GPG_IN_PATH);
		expect(await w.isGPG("")).toBe(CliPathStatus.NO_GPG_IN_PATH);
		expect(fakeSpawn.calls).toEqual([]);
	});

	test("FOUND when the version output contains \"gpg\" and \"GnuPG\"", async () => {
		fakeSpawn.script(() => ({ stdout: VERSION_OUTPUT }));
		const w = new BackendWrapper();
		expect(await w.isGPG("/usr/bin/gpg")).toBe(CliPathStatus.FOUND);
		expect(fakeSpawn.calls).toHaveLength(1);
		expect(fakeSpawn.lastCall!.exec).toBe("/usr/bin/gpg");
		expect(fakeSpawn.lastCall!.args).toEqual(["--batch", "--logger-fd", "1", "--version"]);
	});

	test("NO_GPG_IN_OUTPUT when the binary answers but is not GnuPG", async () => {
		fakeSpawn.script(() => ({ stdout: "not gpg\n" }));
		expect(await new BackendWrapper().isGPG("/tmp/fake/gpg")).toBe(CliPathStatus.NO_GPG_IN_OUTPUT);
	});

	test("NO_GPG_IN_OUTPUT when only one of the two markers is present", async () => {
		fakeSpawn.script(() => ({ stdout: "gpg version 9 (Some Other Vendor)\n" }));
		expect(await new BackendWrapper().isGPG("gpg")).toBe(CliPathStatus.NO_GPG_IN_OUTPUT);
		fakeSpawn.script(() => ({ stdout: "GnuPG-compatible shim\n" }));
		expect(await new BackendWrapper().isGPG("gpg")).toBe(CliPathStatus.NO_GPG_IN_OUTPUT);
	});

	test("ENOENT when spawn reports ENOENT", async () => {
		fakeSpawn.script(() => ({ error: spawnError("ENOENT") }));
		expect(await new BackendWrapper().isGPG("/nonexistent/gpg")).toBe(CliPathStatus.ENOENT);
	});

	test.each(["EACCES", "EPERM"])("NO_PERMISSION when spawn reports %s", async (code) => {
		fakeSpawn.script(() => ({ error: spawnError(code) }));
		expect(await new BackendWrapper().isGPG("/root/gpg")).toBe(CliPathStatus.NO_PERMISSION);
	});

	test("UNKNOWN_ERROR for any other spawn error code", async () => {
		fakeSpawn.script(() => ({ error: spawnError("EMFILE") }));
		expect(await new BackendWrapper().isGPG("gpg")).toBe(CliPathStatus.UNKNOWN_ERROR);
	});

	test("UNKNOWN_ERROR when gpg exits non-zero (the rejection carries no `code`)", async () => {
		fakeSpawn.script(() => ({ stdout: "", stderr: "gpg: invalid option\n", code: 2 }));
		expect(await new BackendWrapper().isGPG("gpg")).toBe(CliPathStatus.UNKNOWN_ERROR);
	});

	// F18: version() throws whenever stderr is non-empty, even with a perfectly good version on stdout.
	test.fails("[F18] version() tolerates benign warnings on stderr (unsafe permissions on homedir)", async () => {
		fakeSpawn.script(() => ({
			stdout: VERSION_OUTPUT,
			stderr: "gpg: WARNING: unsafe permissions on homedir '/home/user/.gnupg'\n",
		}));
		expect(await new BackendWrapper().isGPG("gpg")).toBe(CliPathStatus.FOUND);
	});

	// F18: checkPath validates the TRIMMED path but the untrimmed string is what gets spawned.
	test.fails("[F18] isGPG spawns the trimmed executable path", async () => {
		fakeSpawn.script(() => ({ stdout: VERSION_OUTPUT }));
		await new BackendWrapper().isGPG("  /usr/bin/gpg  ");
		expect(fakeSpawn.lastCall!.exec).toBe("/usr/bin/gpg");
	});
});

describe("version", () => {
	test("passes [--batch, --logger-fd, 1, --version] to the configured executable and returns trimmed stdout", async () => {
		fakeSpawn.script(() => ({ stdout: VERSION_OUTPUT }));
		const w = new BackendWrapper();
		w.setExecutable("/custom/gpg2");
		expect(await w.version()).toBe("gpg (GnuPG) 2.4.7\nlibgcrypt 1.10.3");
		expect(fakeSpawn.lastCall!.exec).toBe("/custom/gpg2");
		expect(fakeSpawn.lastCall!.args).toEqual(["--batch", "--logger-fd", "1", "--version"]);
		expect(fakeSpawn.lastCall!.process.stdinData).toBe("");
	});

	test("an explicit path argument overrides the configured executable", async () => {
		fakeSpawn.script(() => ({ stdout: VERSION_OUTPUT }));
		const w = new BackendWrapper();
		await w.version("/other/gpg");
		expect(fakeSpawn.lastCall!.exec).toBe("/other/gpg");
		expect(w.getExecutable()).toBe("gpg"); // unchanged
	});

	test("rejects with the spawn error", async () => {
		const err = spawnError("ENOENT");
		fakeSpawn.script(() => ({ error: err }));
		await expect(new BackendWrapper().version()).rejects.toBe(err);
	});

	test("rejects when stderr has content even though stdout has the version (F18, see isGPG)", async () => {
		fakeSpawn.script(() => ({ stdout: VERSION_OUTPUT, stderr: "gpg: WARNING: something\n" }));
		await expect(new BackendWrapper().version()).rejects.toThrow(/WARNING: something/);
	});
});

describe("getPublicKeys", () => {
	test("parses the --with-colons fixture into keyID/userID pairs", async () => {
		fakeSpawn.script(() => ({ stdout: GPG_LIST_KEYS_COLONS }));
		const keys = await new BackendWrapper().getPublicKeys();
		expect(keys).toEqual([
			{ keyID: KEYS.nopass.keyId, userID: "gpgCrypt TEST-ONLY nopass <nopass@example.invalid>" },
			{ keyID: KEYS.pw.keyId, userID: "gpgCrypt TEST-ONLY pw <pw@example.invalid>" },
		]);
	});

	test("passes [--batch, --logger-fd, 1, --list-public-keys, --with-colons] without stdin", async () => {
		fakeSpawn.script(() => ({ stdout: GPG_LIST_KEYS_COLONS }));
		const w = new BackendWrapper();
		w.setExecutable("/usr/bin/gpg");
		await w.getPublicKeys();
		expect(fakeSpawn.lastCall!.exec).toBe("/usr/bin/gpg");
		expect(fakeSpawn.lastCall!.args).toEqual(["--batch", "--logger-fd", "1", "--list-public-keys", "--with-colons"]);
		expect(fakeSpawn.lastCall!.process.stdinData).toBe("");
	});

	test("empty stdout (no keys in the keyring) → []", async () => {
		fakeSpawn.script(() => ({ stdout: "" }));
		expect(await new BackendWrapper().getPublicKeys()).toEqual([]);
	});

	test("only the trust line (keyring exists but is empty) → []", async () => {
		fakeSpawn.script(() => ({ stdout: "tru::1:1786823810:0:3:1:5\n" }));
		expect(await new BackendWrapper().getPublicKeys()).toEqual([]);
	});

	test("secret-key listing lines (sec/ssb) are ignored — only pub records start a key", async () => {
		const secOnly = GPG_LIST_KEYS_COLONS.replace(/^pub:/gm, "sec:").replace(/^sub:/gm, "ssb:");
		fakeSpawn.script(() => ({ stdout: secOnly }));
		expect(await new BackendWrapper().getPublicKeys()).toEqual([]);
	});

	// F18 says "leaves \r on Windows" — for the two fields the parser reads this does NOT manifest, because
	// every colon record ends with a trailing ":" so the "\r" lands in the (unused) last field.
	test("[F18] a CRLF (Windows) variant of the listing parses to the same keyID/userID pairs (\\r ends up in the unused last field)", async () => {
		fakeSpawn.script(() => ({ stdout: GPG_LIST_KEYS_COLONS.replace(/\n/g, "\r\n") }));
		const keys = await new BackendWrapper().getPublicKeys();
		expect(keys).toEqual([
			{ keyID: KEYS.nopass.keyId, userID: "gpgCrypt TEST-ONLY nopass <nopass@example.invalid>" },
			{ keyID: KEYS.pw.keyId, userID: "gpgCrypt TEST-ONLY pw <pw@example.invalid>" },
		]);
		for (const k of keys) {
			expect(k.keyID).not.toContain("\r");
			expect(k.userID).not.toContain("\r");
		}
	});

	// F18: one entry per uid, so a key with several user ids appears several times (same keyID).
	test("[F18] a key with two uids yields two entries with the same keyID (documents current behaviour)", async () => {
		const twoUids = [
			"pub:-:255:22:B48213D516D720CC:1786823810:::-:::scESC:::::ed25519:::0:",
			"fpr:::::::::1A187C059A1205450046D349B48213D516D720CC:",
			"uid:-::::1786823810::AAAA::Primary Name <primary@example.invalid>::::::::::0:",
			"uid:-::::1786823810::BBBB::Second Name <second@example.invalid>::::::::::0:",
			"sub:-:255:18:260E3304B9F03FED:1786823810::::::e:::::cv25519::",
			"",
		].join("\n");
		fakeSpawn.script(() => ({ stdout: twoUids }));
		const keys = await new BackendWrapper().getPublicKeys();
		expect(keys).toEqual([
			{ keyID: "B48213D516D720CC", userID: "Primary Name <primary@example.invalid>" },
			{ keyID: "B48213D516D720CC", userID: "Second Name <second@example.invalid>" },
		]);
	});

	// F18: validity is not inspected — revoked ("r") / expired ("e") keys are offered as recipients.
	test("[F18] revoked and expired keys are not filtered out (documents current behaviour)", async () => {
		const listing = [
			"pub:r:255:22:AAAAAAAAAAAAAAAA:1786823810:::-:::scESC:::::ed25519:::0:",
			"uid:r::::1786823810::X::Revoked <revoked@example.invalid>::::::::::0:",
			"pub:e:255:22:BBBBBBBBBBBBBBBB:1786823810:1786823811::-:::scESC:::::ed25519:::0:",
			"uid:e::::1786823810::Y::Expired <expired@example.invalid>::::::::::0:",
			"",
		].join("\n");
		fakeSpawn.script(() => ({ stdout: listing }));
		expect(await new BackendWrapper().getPublicKeys()).toEqual([
			{ keyID: "AAAAAAAAAAAAAAAA", userID: "Revoked <revoked@example.invalid>" },
			{ keyID: "BBBBBBBBBBBBBBBB", userID: "Expired <expired@example.invalid>" },
		]);
	});

	test("stderr warnings do not prevent parsing (the `error` of the spawn result is ignored here)", async () => {
		fakeSpawn.script(() => ({ stdout: GPG_LIST_KEYS_COLONS, stderr: "gpg: WARNING: unsafe permissions on homedir\n" }));
		expect(await new BackendWrapper().getPublicKeys()).toHaveLength(2);
	});

	test("a spawn error (ENOENT) yields [] instead of rejecting (F18: `error` is ignored)", async () => {
		fakeSpawn.script(() => ({ error: spawnError("ENOENT") }));
		expect(await new BackendWrapper().getPublicKeys()).toEqual([]);
	});

	test("a non-zero exit rejects with gpg's stderr", async () => {
		fakeSpawn.script(() => ({ stdout: "", stderr: "gpg: keyblock resource error\n", code: 2 }));
		await expect(new BackendWrapper().getPublicKeys()).rejects.toThrow("keyblock resource error");
	});
});

describe("encrypt", () => {
	const ARGS = ["--armor", "--recipient", "B48213D516D720CC", "--compression-algo", "none"];

	test("argv is [--batch, ...args, --encrypt] and the plaintext goes to stdin", async () => {
		fakeSpawn.script(() => ({ stdout: "-----BEGIN PGP MESSAGE-----\n...\n-----END PGP MESSAGE-----\n", waitForStdinEnd: true }));
		const w = new BackendWrapper();
		w.setExecutable("/usr/bin/gpg");
		const out = await w.encrypt("Hello secret world\n", ARGS);
		expect(fakeSpawn.lastCall!.exec).toBe("/usr/bin/gpg");
		expect(fakeSpawn.lastCall!.args).toEqual(["--batch", ...ARGS, "--encrypt"]);
		expect(fakeSpawn.lastCall!.process.stdinData).toBe("Hello secret world\n");
		expect(fakeSpawn.lastCall!.process.stdinEnded).toBe(true);
		expect(out).toBe("-----BEGIN PGP MESSAGE-----\n...\n-----END PGP MESSAGE-----");
	});

	test("args are optional", async () => {
		fakeSpawn.script(() => ({ stdout: "ct" }));
		await new BackendWrapper().encrypt("x");
		expect(fakeSpawn.lastCall!.args).toEqual(["--batch", "--encrypt"]);
	});

	test("returns stdout as string", async () => {
		fakeSpawn.script(() => ({ stdout: Buffer.from("armored-bytes") }));
		expect(await new BackendWrapper().encrypt("x", ARGS)).toBe("armored-bytes");
	});

	test("rejects with gpg's stderr when gpg exits non-zero", async () => {
		fakeSpawn.script(() => ({ stdout: "", stderr: "gpg: B48213D516D720CC: skipped: No public key\ngpg: [stdin]: encryption failed: No public key\n", code: 2 }));
		await expect(new BackendWrapper().encrypt("x", ARGS)).rejects.toThrow("encryption failed: No public key");
	});

	test("rejects with the spawn error (ENOENT)", async () => {
		const err = spawnError("ENOENT");
		fakeSpawn.script(() => ({ error: err }));
		await expect(new BackendWrapper().encrypt("x", ARGS)).rejects.toBe(err);
	});

	test("stderr warnings alongside a successful encryption are ignored", async () => {
		fakeSpawn.script(() => ({ stdout: "ct", stderr: "gpg: WARNING: unsafe permissions on homedir\n" }));
		expect(await new BackendWrapper().encrypt("x", ARGS)).toBe("ct");
	});

	// F06: `.trim()` on the result — harmless for armored ciphertext, but the same code shape is used for
	// decrypted plaintext (processDecrypt) where it is lossy.
	test.fails("[F06] encrypt does not trim gpg's output", async () => {
		fakeSpawn.script(() => ({ stdout: "  text with trailing newline\n" }));
		expect(await new BackendWrapper().encrypt("x", ARGS)).toBe("  text with trailing newline\n");
	});
});

describe("initDecrypt / processDecrypt", () => {
	test("initDecrypt forwards args ([--batch, ...args, --decrypt]) and feeds the ciphertext to stdin", async () => {
		fakeSpawn.script(() => ({ stdout: "plain", waitForStdinEnd: true }));
		const w = new BackendWrapper();
		const spawned = w.initDecrypt("-----BEGIN PGP MESSAGE-----\nct\n-----END PGP MESSAGE-----\n", ["--trust-model", "always"]);
		expect(typeof spawned.kill).toBe("function");
		expect(spawned.gpgResult).toBeInstanceOf(Promise);
		expect(await w.processDecrypt(spawned.gpgResult)).toBe("plain");
		// F05 lives in main.ts (it does not pass the args); the backend itself forwards them correctly.
		expect(fakeSpawn.lastCall!.args).toEqual(["--batch", "--trust-model", "always", "--decrypt"]);
		expect(fakeSpawn.lastCall!.process.stdinData).toBe("-----BEGIN PGP MESSAGE-----\nct\n-----END PGP MESSAGE-----\n");
	});

	test("initDecrypt without args", async () => {
		fakeSpawn.script(() => ({ stdout: "plain" }));
		const w = new BackendWrapper();
		await w.processDecrypt(w.initDecrypt("ct").gpgResult);
		expect(fakeSpawn.lastCall!.args).toEqual(["--batch", "--decrypt"]);
	});

	test("processDecrypt resolves with stdout", async () => {
		fakeSpawn.script(() => ({ stdout: "Hello secret world" }));
		const w = new BackendWrapper();
		expect(await w.processDecrypt(w.initDecrypt("ct").gpgResult)).toBe("Hello secret world");
	});

	test("processDecrypt rejects with gpg's stderr on non-zero exit (wrong key / bad passphrase)", async () => {
		fakeSpawn.script(() => ({ stdout: "", stderr: "gpg: decryption failed: No secret key\n", code: 2 }));
		const w = new BackendWrapper();
		await expect(w.processDecrypt(w.initDecrypt("ct").gpgResult)).rejects.toThrow("No secret key");
	});

	test("processDecrypt rejects with the spawn error when the result is undefined ({ result: undefined, error })", async () => {
		const err = spawnError("EACCES");
		fakeSpawn.script(() => ({ error: err }));
		const w = new BackendWrapper();
		await expect(w.processDecrypt(w.initDecrypt("ct").gpgResult)).rejects.toBe(err);
	});

	test("processDecrypt accepts a hand-made result promise", async () => {
		const w = new BackendWrapper();
		expect(await w.processDecrypt(Promise.resolve({ result: Buffer.from("x") }))).toBe("x");
		const err = new Error("boom");
		await expect(w.processDecrypt(Promise.resolve({ result: undefined, error: err }))).rejects.toBe(err);
		await expect(w.processDecrypt(Promise.reject(err))).rejects.toBe(err);
	});

	test("kill() sends SIGINT and the pending decrypt rejects (no hang)", async () => {
		fakeSpawn.script(() => ({ hang: true }));
		const w = new BackendWrapper();
		const { gpgResult, kill } = w.initDecrypt("ct");
		const pending = w.processDecrypt(gpgResult);
		kill();
		expect(fakeSpawn.lastCall!.process.kill).toHaveBeenCalledWith("SIGINT");
		await expect(pending).rejects.toBeInstanceOf(Error);
	});

	// F06: decrypted plaintext is `.trim()`ed → leading/trailing whitespace and the final newline of a note
	// are lost; the OpenPGP.js backend keeps them, so the two backends disagree on the same note.
	test.fails("[F06] processDecrypt does not trim the decrypted plaintext", async () => {
		fakeSpawn.script(() => ({ stdout: "  text with trailing newline\n" }));
		const w = new BackendWrapper();
		expect(await w.processDecrypt(w.initDecrypt("ct").gpgResult)).toBe("  text with trailing newline\n");
	});

	test("[F06] documents current behaviour: processDecrypt strips surrounding whitespace / final newline", async () => {
		fakeSpawn.script(() => ({ stdout: "\n\n  Hello secret world\n\n" }));
		const w = new BackendWrapper();
		expect(await w.processDecrypt(w.initDecrypt("ct").gpgResult)).toBe("Hello secret world");
	});
});

describe("GPGStatusMessage", () => {
	test("every status has a friendly message", () => {
		for (const status of Object.values(CliPathStatus)) {
			const msg = GPGStatusMessage.getFriendlyMessage(status);
			expect(typeof msg).toBe("string");
			expect(msg.length).toBeGreaterThan(0);
		}
		expect(GPGStatusMessage.getFriendlyMessage(CliPathStatus.FOUND)).toBe("GPG found.");
		expect(GPGStatusMessage.getFriendlyMessage(CliPathStatus.ENOENT)).toBe("File or directory not found.");
	});
});
