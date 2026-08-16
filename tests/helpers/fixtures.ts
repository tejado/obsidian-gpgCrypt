/** Access to the committed TEST-ONLY fixtures (see scripts/gen-test-fixtures.mjs). */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// note: uses node:path rather than `new URL(rel, import.meta.url)` — happy-dom replaces the global URL
const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const fixture = (rel: string) => readFileSync(resolve(FIXTURES_DIR, rel), "utf8");
export { FIXTURES_DIR };

export const KEYS = {
	nopass: {
		publicKey: fixture("keys/nopass.public.asc"),
		privateKey: fixture("keys/nopass.private.asc"),
		passphrase: null as string | null,
		/** long key id of the primary key as printed by `gpg --with-colons` */
		keyId: "B48213D516D720CC",
		fingerprint: "1A187C059A1205450046D349B48213D516D720CC",
	},
	pw: {
		publicKey: fixture("keys/pw.public.asc"),
		privateKey: fixture("keys/pw.private.asc"),
		passphrase: "test" as string | null,
		keyId: "1A440DEF9DEBDD2B",
		fingerprint: "2A15CD393D040F0F22A6435E1A440DEF9DEBDD2B",
	},
};

export const PLAINTEXT = fixture("notes/hello.txt");
export const CIPHERTEXT_NOPASS = fixture("notes/hello.nopass.asc");
export const CIPHERTEXT_PW = fixture("notes/hello.pw.asc");
export const CANARIES = JSON.parse(fixture("notes/canaries.json")) as { mustBeEncrypted: string[]; plaintextCanaries: string[] };
export const GPG_LIST_KEYS_COLONS = fixture("gpg/list-keys.with-colons.txt");

export const PGP_MESSAGE_HEADER = "-----BEGIN PGP MESSAGE-----";

export function isArmoredMessage(text: string | undefined | null): boolean {
	return typeof text === "string" && text.trimStart().startsWith(PGP_MESSAGE_HEADER);
}
