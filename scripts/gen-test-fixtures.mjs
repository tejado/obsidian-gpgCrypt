#!/usr/bin/env node
// Generates the TEST-ONLY key pairs, ciphertext fixtures and the e2e fixture vault files.
// Run once and commit the output (`npm run gen:fixtures`); re-run only to rotate fixtures
// deliberately — every committed ciphertext must match the committed keys.
//
//   tests/fixtures/keys/{nopass,pw}.{public,private}.asc      (pw passphrase: "test")
//   tests/fixtures/notes/{hello.nopass.asc,hello.pw.asc,hello.txt,canaries.json}
//   e2e/vaults/basic/{public,private,public-pw,private-pw}.asc + encrypted notes
import * as openpgp from "openpgp";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keysDir = resolve(root, "tests/fixtures/keys");
const notesDir = resolve(root, "tests/fixtures/notes");
const vaultDir = resolve(root, "e2e/vaults/basic");
for (const d of [keysDir, notesDir, vaultDir, resolve(vaultDir, "secret/nested"), resolve(vaultDir, "other")]) {
	mkdirSync(d, { recursive: true });
}

export const PLAINTEXT = "Hello secret world\n";
export const PW_PASSPHRASE = "test";

async function genKey(label, passphrase) {
	// NOTE: BackendNative.generateKeypair uses `type: "curve25519"`, which in OpenPGP.js v6 produces
	// RFC 9580 Ed25519/X25519 keys (algorithm IDs 27/25) that GnuPG 2.4.x cannot import.
	// Fixtures must also work with the gpg CLI (wrapper backend tests, `gpg --decrypt` interop), 
	// so they use the legacy curve25519 encoding (EdDSA 22 / ECDH 18).
	return openpgp.generateKey({
		type: "ecc",
		curve: "curve25519Legacy",
		userIDs: [{ name: `gpgCrypt TEST-ONLY ${label}`, email: `${label}@example.invalid` }],
		passphrase,
		format: "armored",
	});
}

async function encryptTo(armoredPublicKey, text) {
	const encryptionKeys = await openpgp.readKey({ armoredKey: armoredPublicKey });
	return openpgp.encrypt({ message: await openpgp.createMessage({ text }), encryptionKeys });
}

const nopass = await genKey("nopass", undefined);
const pw = await genKey("pw", PW_PASSPHRASE);

writeFileSync(resolve(keysDir, "nopass.public.asc"), nopass.publicKey);
writeFileSync(resolve(keysDir, "nopass.private.asc"), nopass.privateKey);
writeFileSync(resolve(keysDir, "pw.public.asc"), pw.publicKey);
writeFileSync(resolve(keysDir, "pw.private.asc"), pw.privateKey);

const ctNopass = await encryptTo(nopass.publicKey, PLAINTEXT);
const ctPw = await encryptTo(pw.publicKey, PLAINTEXT);
writeFileSync(resolve(notesDir, "hello.nopass.asc"), ctNopass);
writeFileSync(resolve(notesDir, "hello.pw.asc"), ctPw);
writeFileSync(resolve(notesDir, "hello.txt"), PLAINTEXT);
writeFileSync(
	resolve(notesDir, "canaries.json"),
	JSON.stringify(
		{
			mustBeEncrypted: ["Encrypted.md", "EncryptedPw.md", "Encrypted.gpg"],
			plaintextCanaries: ["Hello secret world", "CANARY_EDIT_1", "CANARY_TYPED_2"],
		},
		null,
		"\t",
	) + "\n",
);

// e2e vault: keys + encrypted notes (plaintext notes are hand-written and committed separately)
writeFileSync(resolve(vaultDir, "public.asc"), nopass.publicKey);
writeFileSync(resolve(vaultDir, "private.asc"), nopass.privateKey);
writeFileSync(resolve(vaultDir, "public-pw.asc"), pw.publicKey);
writeFileSync(resolve(vaultDir, "private-pw.asc"), pw.privateKey);
writeFileSync(resolve(vaultDir, "Encrypted.md"), ctNopass);
writeFileSync(resolve(vaultDir, "EncryptedPw.md"), ctPw);
writeFileSync(resolve(vaultDir, "Encrypted.gpg"), ctNopass);

const fpr = async (armored) => (await openpgp.readKey({ armoredKey: armored })).getFingerprint().toUpperCase();
console.log("Fixtures written.");
console.log("  nopass fingerprint:", await fpr(nopass.publicKey));
console.log("  pw     fingerprint:", await fpr(pw.publicKey), `(passphrase "${PW_PASSPHRASE}")`);
