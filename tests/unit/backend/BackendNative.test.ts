/**
 * BackendNative (src/backend/native/BackendNative.ts) — the OpenPGP.js backend: key loading, encrypt /
 * decrypt round trips, passphrase handling (incl. the exact error strings main.ts string-matches on),
 * `isEncrypted` classification and key generation. Uses the committed TEST-ONLY fixture keys.
 */
import * as openpgp from "openpgp";
import { beforeAll, describe, expect, test } from "vitest";
import { BackendNative } from "src/backend/native/BackendNative";
import { CIPHERTEXT_NOPASS, CIPHERTEXT_PW, KEYS, PLAINTEXT } from "../../helpers/fixtures";

const PGP_MESSAGE_HEADER = "-----BEGIN PGP MESSAGE-----";

async function nopassBackend() {
	const b = new BackendNative();
	await b.setKeys(KEYS.nopass.publicKey, KEYS.nopass.privateKey);
	return b;
}

async function pwBackend() {
	const b = new BackendNative();
	await b.setKeys(KEYS.pw.publicKey, KEYS.pw.privateKey);
	return b;
}

describe("key state", () => {
	test("no keys loaded initially", () => {
		const b = new BackendNative();
		expect(b.hasPublicKey()).toBe(false);
		expect(b.hasPrivateKey()).toBe(false);
		expect(b.isPrivateKeyEncrypted()).toBeFalsy();
	});

	test("setKeys loads both keys", async () => {
		const b = await nopassBackend();
		expect(b.hasPublicKey()).toBe(true);
		expect(b.hasPrivateKey()).toBe(true);
	});

	test("setKeys(null, null) resets both keys", async () => {
		const b = await nopassBackend();
		await b.setKeys(null, null);
		expect(b.hasPublicKey()).toBe(false);
		expect(b.hasPrivateKey()).toBe(false);
		await expect(b.encrypt("x")).rejects.toThrow("No public key for encryption configured!");
		await expect(b.decrypt(CIPHERTEXT_NOPASS, null)).rejects.toThrow("No private key for decryption configured!");
	});

	test("public and private key can be set independently", async () => {
		const b = new BackendNative();
		await b.setKeys(KEYS.nopass.publicKey, null);
		expect(b.hasPublicKey()).toBe(true);
		expect(b.hasPrivateKey()).toBe(false);
		await b.setKeys(null, KEYS.nopass.privateKey);
		expect(b.hasPublicKey()).toBe(false);
		expect(b.hasPrivateKey()).toBe(true);
	});

	test("setKeys rejects on garbage armor", async () => {
		const b = new BackendNative();
		await expect(b.setKeys("not a key", null)).rejects.toThrow();
		await expect(b.setKeys(null, "not a key")).rejects.toThrow();
		// a public key block is not accepted as a private key
		await expect(b.setKeys(null, KEYS.nopass.publicKey)).rejects.toThrow();
	});

	test("isPrivateKeyEncrypted() is truthy for the passphrase-protected key, falsy for the unprotected one", async () => {
		expect((await pwBackend()).isPrivateKeyEncrypted()).toBeTruthy();
		expect((await nopassBackend()).isPrivateKeyEncrypted()).toBeFalsy();
	});
});

describe("encrypt", () => {
	test("throws without a public key", async () => {
		const b = new BackendNative();
		await expect(b.encrypt("secret")).rejects.toThrow("No public key for encryption configured!");
	});

	test("produces an armored PGP message", async () => {
		const b = await nopassBackend();
		const ct = await b.encrypt("secret");
		expect(typeof ct).toBe("string");
		expect(ct.startsWith(PGP_MESSAGE_HEADER)).toBe(true);
		expect(ct.trimEnd().endsWith("-----END PGP MESSAGE-----")).toBe(true);
		expect(ct).not.toContain("secret");
	});

	test("is randomised (two encryptions of the same text differ)", async () => {
		const b = await nopassBackend();
		expect(await b.encrypt("same")).not.toBe(await b.encrypt("same"));
	});
});

describe("decrypt", () => {
	test("round trip with the unprotected key (passphrase null)", async () => {
		const b = await nopassBackend();
		const ct = await b.encrypt("Hello round trip\n");
		expect(await b.decrypt(ct, null)).toBe("Hello round trip\n");
	});

	test("round trip with the passphrase-protected key", async () => {
		const b = await pwBackend();
		const ct = await b.encrypt("Hello round trip pw\n");
		expect(await b.decrypt(ct, "test")).toBe("Hello round trip pw\n");
	});

	test("decrypts the committed fixture ciphertexts", async () => {
		expect(await (await nopassBackend()).decrypt(CIPHERTEXT_NOPASS, null)).toBe(PLAINTEXT);
		expect(await (await pwBackend()).decrypt(CIPHERTEXT_PW, "test")).toBe(PLAINTEXT);
	});

	test("the passphrase is ignored for an unprotected key", async () => {
		const b = await nopassBackend();
		expect(await b.decrypt(CIPHERTEXT_NOPASS, "whatever")).toBe(PLAINTEXT);
	});

	test("throws without a private key", async () => {
		const b = new BackendNative();
		await b.setKeys(KEYS.nopass.publicKey, null);
		await expect(b.decrypt(CIPHERTEXT_NOPASS, null)).rejects.toThrow("No private key for decryption configured!");
	});

	test("protected key + null passphrase throws \"No passphrase for private key provided!\"", async () => {
		const b = await pwBackend();
		await expect(b.decrypt(CIPHERTEXT_PW, null)).rejects.toThrow("No passphrase for private key provided!");
	});

	// F07: main.ts retries `while (error.message.includes("Incorrect key passphrase"))` — this pins the
	// exact substring the retry loop depends on (brittle across OpenPGP.js upgrades).
	test("wrong passphrase rejects with /Incorrect key passphrase/ (F07: the substring main.ts loops on)", async () => {
		const b = await pwBackend();
		await expect(b.decrypt(CIPHERTEXT_PW, "wrong")).rejects.toThrow(/Incorrect key passphrase/);
	});

	// F07/F20: an empty passphrase yields the same message, so a cached "" spins the same loop.
	test("empty passphrase rejects with /Incorrect key passphrase/ as well (F07/F20)", async () => {
		const b = await pwBackend();
		await expect(b.decrypt(CIPHERTEXT_PW, "")).rejects.toThrow(/Incorrect key passphrase/);
	});

	test("wrong KEY (message for the pw key, nopass private key) rejects — and NOT with the passphrase message", async () => {
		const b = await nopassBackend();
		const p = b.decrypt(CIPHERTEXT_PW, null);
		// OpenPGP.js v6: "Error decrypting message: No decryption key packets found" (the key ids do not match)
		await expect(p).rejects.toThrow(/Error decrypting message/);
		await expect(p).rejects.toThrow(/No decryption key packets found/);
		await expect(p).rejects.not.toThrow(/Incorrect key passphrase/);
	});

	test("garbage input rejects", async () => {
		const b = await nopassBackend();
		await expect(b.decrypt("not a message", null)).rejects.toThrow();
		await expect(b.decrypt("", null)).rejects.toThrow();
	});

	// F17: every decrypt() re-parses the armored private key and re-runs the S2K/KDF unlock (no caching of
	// the unlocked key). We cannot count openpgp calls without spying on the namespace import, so this
	// only asserts that repeated decrypts with the same passphrase keep working.
	test("repeated decrypts with the same passphrase all succeed (F17 documents that each call re-unlocks the key)", async () => {
		const b = await pwBackend();
		for (let i = 0; i < 3; i++) {
			expect(await b.decrypt(CIPHERTEXT_PW, "test")).toBe(PLAINTEXT);
		}
	});
});

describe("testPassphrase", () => {
	test("correct passphrase resolves", async () => {
		const b = await pwBackend();
		await expect(b.testPassphrase("test")).resolves.toBeUndefined();
	});

	test("wrong passphrase rejects with /Incorrect key passphrase/ (F07 substring)", async () => {
		const b = await pwBackend();
		await expect(b.testPassphrase("wrong")).rejects.toThrow(/Incorrect key passphrase/);
		await expect(b.testPassphrase("")).rejects.toThrow(/Incorrect key passphrase/);
	});

	test("unprotected key throws \"Private key is not encrypted.\"", async () => {
		const b = await nopassBackend();
		await expect(b.testPassphrase("test")).rejects.toThrow("Private key is not encrypted.");
	});

	test("null passphrase throws \"No passphrase for private key provided!\"", async () => {
		const b = await pwBackend();
		await expect(b.testPassphrase(null)).rejects.toThrow("No passphrase for private key provided!");
	});

	test("throws without a private key", async () => {
		const b = new BackendNative();
		await expect(b.testPassphrase("test")).rejects.toThrow("No private key for decryption configured!");
	});
});

describe("isEncrypted", () => {
	const b = new BackendNative(); // needs no keys

	test("true for armored PGP messages", async () => {
		expect(await b.isEncrypted(CIPHERTEXT_NOPASS)).toBe(true);
		expect(await b.isEncrypted(CIPHERTEXT_PW)).toBe(true);
	});

	test("true regardless of surrounding whitespace / CRLF line endings", async () => {
		expect(await b.isEncrypted("\n\n" + CIPHERTEXT_NOPASS + "\n\n")).toBe(true);
		expect(await b.isEncrypted(CIPHERTEXT_NOPASS.replace(/\n/g, "\r\n"))).toBe(true);
	});

	test("false for plaintext, empty string and null", async () => {
		expect(await b.isEncrypted("Hello secret world\n")).toBe(false);
		expect(await b.isEncrypted("# Heading\n\nSome markdown")).toBe(false);
		expect(await b.isEncrypted("")).toBe(false);
		expect(await b.isEncrypted(null)).toBe(false);
	});

	test("false for a public key block (armored, but not a message)", async () => {
		expect(await b.isEncrypted(KEYS.nopass.publicKey)).toBe(false);
	});

	test("false for a private key block", async () => {
		expect(await b.isEncrypted(KEYS.nopass.privateKey)).toBe(false);
	});

	test("false for garbage inside PGP MESSAGE armor", async () => {
		const garbage = "-----BEGIN PGP MESSAGE-----\n\nZ2FyYmFnZQ==\n-----END PGP MESSAGE-----\n";
		expect(await b.isEncrypted(garbage)).toBe(false);
	});

	test("false for a bare header line without body", async () => {
		expect(await b.isEncrypted(PGP_MESSAGE_HEADER)).toBe(false);
	});

	// F19: openpgp.readMessage tolerates arbitrary text around an armored block, so a note that merely
	// QUOTES a message is treated as encrypted (and would be "decrypted" on read / re-encrypted on write).
	test.fails("[F19] a plaintext note that merely quotes an armored message is NOT classified as encrypted", async () => {
		const quoting = "# Notes\n\nSee below:\n\n" + CIPHERTEXT_NOPASS + "\n\nmore text";
		expect(await b.isEncrypted(quoting)).toBe(false);
	});
});

describe("generateKeypair", () => {
	let generated: { publicKey: string; privateKey: string };
	const PASSPHRASE = "generated-pw";

	beforeAll(async () => {
		generated = await new BackendNative().generateKeypair("Unit Test", "unit@example.invalid", PASSPHRASE);
	});

	test("returns armored public and private key blocks", () => {
		expect(generated.publicKey).toMatch(/^-----BEGIN PGP PUBLIC KEY BLOCK-----/);
		expect(generated.privateKey).toMatch(/^-----BEGIN PGP PRIVATE KEY BLOCK-----/);
	});

	test("the generated pair round-trips encrypt/decrypt with the given passphrase and is protected", async () => {
		const b = new BackendNative();
		await b.setKeys(generated.publicKey, generated.privateKey);
		expect(b.isPrivateKeyEncrypted()).toBeTruthy();
		const ct = await b.encrypt("generated round trip\n");
		expect(await b.decrypt(ct, PASSPHRASE)).toBe("generated round trip\n");
		await expect(b.decrypt(ct, "nope")).rejects.toThrow(/Incorrect key passphrase/);
		await expect(b.testPassphrase(PASSPHRASE)).resolves.toBeUndefined();
	});

	test("carries the given user id", async () => {
		const key = await openpgp.readKey({ armoredKey: generated.publicKey });
		expect(key.getUserIDs()).toEqual(["Unit Test <unit@example.invalid>"]);
	});

	// F32: `generateKey({ type: "curve25519" })` in OpenPGP.js v6 emits the RFC 9580 algorithms
	// (Ed25519 = 27, X25519 = 25); GnuPG 2.4.x cannot import those keys ("unsupported public-key
	// algorithm"). The fixture keys deliberately use the legacy encoding (eddsaLegacy / ecdh curve25519Legacy).
	test("[F32] generated keys use RFC 9580 ed25519/x25519 (GnuPG 2.4.x cannot import them)", async () => {
		const key = await openpgp.readKey({ armoredKey: generated.publicKey });
		expect(key.getAlgorithmInfo().algorithm).toBe("ed25519");
		expect(key.subkeys.length).toBeGreaterThan(0);
		expect(key.subkeys[0].getAlgorithmInfo().algorithm).toBe("x25519");

		// contrast: the fixtures are legacy-curve keys (interoperable with every GnuPG 2.x)
		const fixture = await openpgp.readKey({ armoredKey: KEYS.nopass.publicKey });
		expect(fixture.getAlgorithmInfo().algorithm).toBe("eddsaLegacy");
		expect(fixture.subkeys[0].getAlgorithmInfo().algorithm).toBe("ecdh");
	});
});
