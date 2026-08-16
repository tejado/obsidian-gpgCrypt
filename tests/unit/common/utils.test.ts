/**
 * src/common/utils.ts — key-id validation, .md/.gpg extension swapping and the DEBUG-gated `_log`.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { _log, changeFileExtGpgToMd, changeFileExtMdToGpg, isGpgKey } from "src/common/utils";

describe("isGpgKey", () => {
	test.each([
		"A",
		"0",
		"B48213D516D720CC", // long key id (16)
		"1A440DEF9DEBDD2B",
		"b48213d516d720cc", // lower-case hex
		"1A187C059A1205450046D349B48213D516D720CC".slice(0, 32), // 32 chars (max)
		"12345678", // short key id
	])("accepts %s (1–32 hex chars)", (id) => {
		expect(isGpgKey(id)).toBe(true);
	});

	test.each([
		["", "empty"],
		["A".repeat(33), "33 chars"],
		["0xB48213D516D720CC", "0x prefix"],
		[" B48213D516D720CC", "leading whitespace"],
		["B48213D516D720CC ", "trailing whitespace"],
		["B482 13D5 16D7 20CC", "inner spaces (fingerprint formatting)"],
		["--recipient", "argument injection"],
		["B48213D516D720CC --armor", "argument injection after key"],
		["GHIJKL", "non-hex letters"],
		["nopass@example.invalid", "e-mail user id"],
		["B48213D516D720CC\n", "trailing newline"],
	])("rejects %j (%s)", (id) => {
		expect(isGpgKey(id)).toBe(false);
	});
});

describe("changeFileExtMdToGpg / changeFileExtGpgToMd", () => {
	test("replaces only the trailing extension", () => {
		expect(changeFileExtMdToGpg("note.md")).toBe("note.gpg");
		expect(changeFileExtGpgToMd("note.gpg")).toBe("note.md");
		expect(changeFileExtMdToGpg("folder/sub/note.md")).toBe("folder/sub/note.gpg");
		expect(changeFileExtGpgToMd("folder/sub/note.gpg")).toBe("folder/sub/note.md");
	});

	test("names without the extension are untouched", () => {
		expect(changeFileExtMdToGpg("note.txt")).toBe("note.txt");
		expect(changeFileExtMdToGpg("note.gpg")).toBe("note.gpg");
		expect(changeFileExtGpgToMd("note.md")).toBe("note.md");
		expect(changeFileExtGpgToMd("note")).toBe("note");
		expect(changeFileExtMdToGpg("")).toBe("");
		expect(changeFileExtGpgToMd("")).toBe("");
	});

	test("the extension appearing elsewhere in the name is not touched", () => {
		expect(changeFileExtMdToGpg("a.md.md")).toBe("a.md.gpg");
		expect(changeFileExtGpgToMd("a.gpg.gpg")).toBe("a.gpg.md");
		expect(changeFileExtMdToGpg("my.md-notes/a.md")).toBe("my.md-notes/a.gpg");
		expect(changeFileExtMdToGpg("readme.md.bak")).toBe("readme.md.bak");
		expect(changeFileExtGpgToMd("keys.gpg.txt")).toBe("keys.gpg.txt");
	});

	test("is case sensitive (Obsidian extensions are lower-case)", () => {
		expect(changeFileExtMdToGpg("NOTE.MD")).toBe("NOTE.MD");
		expect(changeFileExtGpgToMd("NOTE.GPG")).toBe("NOTE.GPG");
	});

	test("md → gpg → md is an involution", () => {
		for (const name of ["a.md", "dir/b.md", "c.md.md", "weird name with spaces.md", ".md"]) {
			expect(changeFileExtGpgToMd(changeFileExtMdToGpg(name))).toBe(name);
		}
		for (const name of ["a.gpg", "dir/b.gpg", "c.gpg.gpg"]) {
			expect(changeFileExtMdToGpg(changeFileExtGpgToMd(name))).toBe(name);
		}
	});
});

describe("_log", () => {
	const savedDebug = process.env.DEBUG;

	afterEach(() => {
		if (savedDebug === undefined) {
			delete process.env.DEBUG;
		} else {
			process.env.DEBUG = savedDebug;
		}
	});

	test("is silent when process.env.DEBUG is unset", () => {
		delete process.env.DEBUG;
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		_log("should not print", { a: 1 });
		expect(spy).not.toHaveBeenCalled();
	});

	test("prints a \"[file:line]\"-prefixed line when process.env.DEBUG=\"1\"", () => {
		process.env.DEBUG = "1";
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		const payload = { a: 1 };
		// A *named* caller produces the V8 frame "at namedCaller (/abs/path/utils.test.ts:L:C)" that _log parses.
		function namedCaller() {
			_log("hello", payload);
		}
		namedCaller();
		expect(spy).toHaveBeenCalledTimes(1);
		const [prefix, ...rest] = spy.mock.calls[0];
		// F26: the frame parser assumes V8 "(path:line:col)" frames with "/" separators — fine here (Linux/V8).
		expect(prefix).toMatch(/^\[utils\.test\.ts(\?[^:\]]*)?:\d+\]$/);
		expect(rest).toEqual(["hello", payload]);
	});

	// F26-adjacent: V8 prints frames of anonymous functions (arrow callbacks, which is how most of the
	// plugin's hooks are written) WITHOUT parentheses ("at /abs/path/file.ts:L:C"), so the
	// `/\((.*):(\d+):\d+\)$/` parser does not match and the whole stack trace is dumped instead of a
	// "[file:line]" prefix. Documents current behaviour.
	test("[F26] anonymous (arrow-function) callers get the whole stack dumped instead of \"[file:line]\"", () => {
		process.env.DEBUG = "1";
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		// note: `const f = () => …` would get an inferred function name; an inline callback stays anonymous
		[0].forEach(() => _log("hello"));
		expect(spy).toHaveBeenCalledTimes(1);
		const [first, ...rest] = spy.mock.calls[0];
		expect(String(first)).toMatch(/^Error:?\s*\n\s+at _log /);
		expect(rest).toEqual(["hello"]);
	});

	test("any truthy DEBUG value enables logging (the string \"false\" too — F26 string-vs-boolean)", () => {
		process.env.DEBUG = "false";
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		_log("x");
		expect(spy).toHaveBeenCalledTimes(1);
	});
});
