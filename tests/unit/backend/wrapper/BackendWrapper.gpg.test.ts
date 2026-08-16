/**
 * BackendWrapper against a REAL GnuPG binary. Skipped unless `GPG_INTEGRATION=1` and `gpg --version` works.
 *
 * It expects `GNUPGHOME` to point at an ISOLATED home into which the TEST-ONLY fixture keys were imported
 * (never run it against your personal keyring). Recipe (Linux/macOS, GnuPG 2.2+):
 *
 *   export GNUPGHOME=/tmp/gnupghome-ci            # any fresh directory
 *   mkdir -p "$GNUPGHOME" && chmod 700 "$GNUPGHOME"
 *   printf 'batch\nno-tty\npinentry-mode loopback\ntrust-model always\n' > "$GNUPGHOME/gpg.conf"
 *   printf 'allow-loopback-pinentry\n' > "$GNUPGHOME/gpg-agent.conf"
 *   gpg --batch --import tests/fixtures/keys/nopass.private.asc
 *   gpg --batch --pinentry-mode loopback --passphrase test --import tests/fixtures/keys/pw.private.asc
 *   GPG_INTEGRATION=1 npx vitest run --project unit tests/unit/backend/wrapper/BackendWrapper.gpg.test.ts
 *   gpgconf --kill all                             # stop the agent started for that home
 *
 * `GPG_BIN` overrides the executable (default "gpg").
 */
import { execFileSync } from "node:child_process";
import * as openpgp from "openpgp";
import { beforeAll, describe, expect, test } from "vitest";
import { BackendWrapper, CliPathStatus } from "src/backend/wrapper/BackendWrapper";
import { CIPHERTEXT_NOPASS, CIPHERTEXT_PW, KEYS } from "../../../helpers/fixtures";

const GPG_BIN = process.env.GPG_BIN ?? "gpg";

function probeGpg(): boolean {
	try {
		execFileSync(GPG_BIN, ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
		return true;
	} catch {
		return false;
	}
}

const gpgAvailable = probeGpg();
const enabled = process.env.GPG_INTEGRATION === "1" && gpgAvailable;

if (process.env.GPG_INTEGRATION === "1" && !gpgAvailable) {
	console.warn(`[BackendWrapper.gpg.test] GPG_INTEGRATION=1 but "${GPG_BIN} --version" failed — skipping`);
}

const race = <T>(p: Promise<T>, ms: number) =>
	Promise.race([p, new Promise<"TIMEOUT">((r) => setTimeout(() => r("TIMEOUT"), ms))]);

describe.runIf(enabled)("BackendWrapper with real gpg", () => {
	const w = new BackendWrapper();
	w.setExecutable(GPG_BIN);
	const nopassRecipient = ["--armor", "--recipient", KEYS.nopass.keyId, "--compression-algo", "none", "--trust-model", "always"];

	beforeAll(async () => {
		expect(process.env.GNUPGHOME, "GNUPGHOME must point at an isolated home (see the recipe at the top of this file)").toBeTruthy();
		const keys = await w.getPublicKeys();
		const ids = keys.map((k) => k.keyID);
		expect(ids, "fixture keys are not imported into GNUPGHOME — see the recipe at the top of this file").toContain(KEYS.nopass.keyId);
	});

	test("version() reports GnuPG", async () => {
		const v = await w.version();
		expect(v).toContain("GnuPG");
		expect(v).toMatch(/^gpg \(GnuPG\) \d+\.\d+/);
	});

	test("isGPG(GPG_BIN) === FOUND", async () => {
		expect(await w.isGPG(GPG_BIN)).toBe(CliPathStatus.FOUND);
	});

	test("isGPG on a non-existent path === ENOENT", async () => {
		expect(await w.isGPG("/nonexistent/dir/gpg")).toBe(CliPathStatus.ENOENT);
	});

	test("getPublicKeys() lists both fixture keys with their user ids", async () => {
		const keys = await w.getPublicKeys();
		expect(keys).toContainEqual({ keyID: KEYS.nopass.keyId, userID: "gpgCrypt TEST-ONLY nopass <nopass@example.invalid>" });
		expect(keys).toContainEqual({ keyID: KEYS.pw.keyId, userID: "gpgCrypt TEST-ONLY pw <pw@example.invalid>" });
	});

	test("encrypt() → armored ciphertext that OpenPGP.js decrypts with the fixture private key", async () => {
		const ct = await w.encrypt("hello from wrapper", nopassRecipient);
		expect(ct.startsWith("-----BEGIN PGP MESSAGE-----")).toBe(true);
		expect(ct.trimEnd().endsWith("-----END PGP MESSAGE-----")).toBe(true);

		const privateKey = await openpgp.readPrivateKey({ armoredKey: KEYS.nopass.privateKey });
		const message = await openpgp.readMessage({ armoredMessage: ct });
		const { data } = await openpgp.decrypt({ message, decryptionKeys: privateKey });
		expect(data).toBe("hello from wrapper");
	});

	test("encrypt() with --compression-algo zlib is decryptable by OpenPGP.js as well", async () => {
		const args = ["--armor", "--recipient", KEYS.nopass.keyId, "--compression-algo", "zlib", "--trust-model", "always"];
		const ct = await w.encrypt("compressed hello", args);
		const privateKey = await openpgp.readPrivateKey({ armoredKey: KEYS.nopass.privateKey });
		const { data } = await openpgp.decrypt({ message: await openpgp.readMessage({ armoredMessage: ct }), decryptionKeys: privateKey });
		expect(data).toBe("compressed hello");
	});

	test("encrypt() to the pw key and decrypt via gpg with a loopback passphrase", async () => {
		const ct = await w.encrypt("for the pw key", ["--armor", "--recipient", KEYS.pw.keyId, "--trust-model", "always"]);
		const { gpgResult } = w.initDecrypt(ct, ["--pinentry-mode", "loopback", "--passphrase", "test"]);
		expect(await w.processDecrypt(gpgResult)).toBe("for the pw key");
	});

	test("initDecrypt + processDecrypt of the fixture ciphertext (F06: the wrapper trims the final newline)", async () => {
		const { gpgResult } = w.initDecrypt(CIPHERTEXT_NOPASS, ["--trust-model", "always"]);
		// PLAINTEXT is "Hello secret world\n" — the wrapper `.trim()`s the decrypted output (F06)
		expect(await w.processDecrypt(gpgResult)).toBe("Hello secret world");
	});

	test("initDecrypt + processDecrypt of the OpenPGP.js-made pw ciphertext with a loopback passphrase", async () => {
		const { gpgResult } = w.initDecrypt(CIPHERTEXT_PW, ["--pinentry-mode", "loopback", "--passphrase", "test"]);
		expect(await w.processDecrypt(gpgResult)).toBe("Hello secret world");
	});

	// note: no "wrong passphrase" case here — gpg-agent caches the passphrase after the first successful
	// unlock (default-cache-ttl), so the outcome would depend on test order / agent state, not on the wrapper.

	test("initDecrypt of invalid input rejects (and kill() afterwards is harmless — no hang)", async () => {
		const { gpgResult, kill } = w.initDecrypt("this is not a pgp message\n");
		const settled = await race(w.processDecrypt(gpgResult).then(() => "RESOLVED", () => "REJECTED"), 10_000);
		expect(settled).toBe("REJECTED");
		expect(() => kill()).not.toThrow();
	});

	// F04: an empty input never closes stdin, so gpg would wait forever — kill() is the only way out.
	test("kill() aborts a gpg process that is blocked on stdin (empty input, F04) — the promise rejects instead of hanging", async () => {
		const { gpgResult, kill } = w.initDecrypt("");
		const pending = w.processDecrypt(gpgResult).then(() => "RESOLVED", () => "REJECTED");
		expect(await race(pending, 300)).toBe("TIMEOUT"); // still blocked
		kill();
		expect(await race(pending, 10_000)).toBe("REJECTED");
	});
});
