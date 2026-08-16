/**
 * Property-based round-trip tests for the OpenPGP.js backend: decrypt(encrypt(x)) === x.
 *
 * Empirical note (OpenPGP.js v6, `createMessage({ text })` = text-mode literal packet): the round trip is
 * exact for arbitrary strings — empty, NUL bytes, astral/emoji, leading/trailing whitespace, lone "\r" —
 * EXCEPT for two cases:
 *   1. every "\r\n" sequence comes back as "\n" (line endings are normalised to CRLF on encrypt and back
 *      to LF on decrypt);
 *   2. a LEADING U+FEFF (byte-order mark) is dropped (the UTF-8 decoder strips it); a BOM elsewhere survives.
 * The properties therefore exclude those inputs and the lossy cases are documented below as
 * "[F35]" (F06 is the analogous lossy `.trim()` in the CLI wrapper backend).
 */
import { fc, test as ptest } from "@fast-check/vitest";
import { beforeAll, describe, expect, test } from "vitest";
import { BackendNative } from "src/backend/native/BackendNative";
import { KEYS } from "../../helpers/fixtures";

/** inputs the text-mode round trip is known to alter (see header comment) */
const lossless = (s: string) => !s.includes("\r\n") && !s.startsWith("\uFEFF");

let backend: BackendNative;

beforeAll(async () => {
	backend = new BackendNative();
	await backend.setKeys(KEYS.nopass.publicKey, KEYS.nopass.privateKey);
});

async function roundTrip(text: string): Promise<string> {
	const ct = await backend.encrypt(text);
	return backend.decrypt(ct, null);
}

describe("decrypt(encrypt(x)) === x", () => {
	ptest.prop([fc.string().filter(lossless)], { numRuns: 25 })(
		"arbitrary strings (no CRLF)",
		async (s) => {
			expect(await roundTrip(s)).toBe(s);
		},
	);

	// fast-check v4: `fc.string({ unit: "binary" })` = any code point (astral planes / emoji included);
	// it replaces the former `fc.fullUnicodeString()`.
	ptest.prop([fc.string({ unit: "binary" }).filter(lossless)], { numRuns: 25 })(
		"full-unicode strings incl. astral planes / emoji (no CRLF)",
		async (s) => {
			expect(await roundTrip(s)).toBe(s);
		},
	);

	ptest.prop([fc.string({ unit: "grapheme", minLength: 1 }).filter(lossless)], { numRuns: 10 })(
		"grapheme clusters (combining marks, ZWJ sequences)",
		async (s) => {
			expect(await roundTrip(s)).toBe(s);
		},
	);

	// ~200 KB: a random unit repeated until it exceeds 200_000 chars (generating 200k independent chars
	// with fc.string would be needlessly slow).
	ptest.prop(
		[fc.string({ minLength: 8, maxLength: 64 }).filter(lossless).map((unit) => unit.repeat(Math.ceil(200_000 / unit.length)))],
		{ numRuns: 3 },
	)("large (~200 KB) strings", async (s) => {
		expect(s.length).toBeGreaterThanOrEqual(200_000);
		expect(await roundTrip(s)).toBe(s);
	});

	test.each([
		["empty string", ""],
		["single NUL", "\0"],
		["NUL inside text", "nul\0byte\0"],
		["lone CR is preserved", "a\rb\r"],
		["leading/trailing whitespace is preserved", "  \t lead and trail \t  "],
		["only whitespace", " \n\t\n "],
		["trailing newlines are preserved", "trail\n\n\n"],
		["emoji / astral", "\u{1F600} astral \u{1F680}\u{1F468}\u200D\u{1F469}\u200D\u{1F467}"],
		["BOM in the middle of the text is preserved", "text \uFEFF with bom inside"],
		["typical markdown note", "# Title\n\n- item **bold**\n\n```ts\nconst x = 1;\n```\n"],
	])("explicit case: %s", async (_name, s) => {
		expect(await roundTrip(s)).toBe(s);
	});
});

describe("[F35] CRLF line endings are not preserved by the OpenPGP.js text mode", () => {
	// Desired behaviour: a Windows-style note comes back byte-for-byte. Currently "\r\n" → "\n".
	test.fails("[F35] a note with CRLF line endings round-trips unchanged", async () => {
		expect(await roundTrip("line1\r\nline2\r\n")).toBe("line1\r\nline2\r\n");
	});

	// Desired behaviour: a note starting with a UTF-8 BOM (some Windows editors write one) keeps it.
	test.fails("[F35] a leading byte-order mark (U+FEFF) round-trips unchanged", async () => {
		expect(await roundTrip("\uFEFFwith bom")).toBe("\uFEFFwith bom");
	});

	test("[F35] documents current behaviour: a leading BOM is dropped, a later one is kept", async () => {
		expect(await roundTrip("\uFEFFwith bom")).toBe("with bom");
		expect(await roundTrip("\uFEFF\uFEFFdouble")).toBe("\uFEFFdouble");
	});

	ptest.prop([fc.array(fc.string().filter((s) => !s.includes("\r") && !s.includes("\n") && !s.startsWith("\uFEFF")), { minLength: 2, maxLength: 6 })], { numRuns: 10 })(
		"[F35] documents current behaviour: every \"\\r\\n\" becomes \"\\n\", everything else is kept",
		async (lines) => {
			const crlf = lines.join("\r\n");
			expect(await roundTrip(crlf)).toBe(lines.join("\n"));
		},
	);

	test("[F35] documents current behaviour: mixed endings — only the CRLF pairs change, lone CR survives", async () => {
		expect(await roundTrip("a\nb\r\nc\rd")).toBe("a\nb\nc\rd");
		expect(await roundTrip("a\r\r\nb")).toBe("a\r\nb");
		expect(await roundTrip("\r\n\r\n")).toBe("\n\n");
	});
});
