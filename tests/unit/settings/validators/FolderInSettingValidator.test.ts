/**
 * FolderInSettingValidator (src/settings/validators/ValidateFolderIsInSettings.ts) — decides whether a
 * vault path is covered by the "encrypt all" switch or one of the configured folders.
 * `normalizePath` resolves to the obsidian mock (`\` → `/`, collapse `//`, strip leading/trailing `/`).
 */
import { describe, expect, test } from "vitest";
import { FolderInSettingValidator } from "src/settings/validators/ValidateFolderIsInSettings";
import { ValidationError } from "src/settings/validators/IValidator";
import { Settings } from "src/settings/Settings";

function makeSettings(overrides: Partial<Settings> = {}): Settings {
	return {
		firstLoad: false,
		encryptAll: false,
		foldersToEncrypt: [],
		renameToGpg: false,
		fileRecovery: "encrypted",
		compatibilityMode: false,
		backend: "native",
		backendNative: { publicKeyPath: "public.asc", privateKeyPath: "private.asc" },
		backendWrapper: {
			executable: "gpg",
			recipient: "",
			trustModelAlways: false,
			compression: false,
			cache: true,
			showDecryptModal: true,
		},
		askPassphraseOnStartup: false,
		passphraseTimeout: 300,
		resetPassphraseTimeoutOnWrite: false,
		...overrides,
	};
}

const validatorFor = (overrides: Partial<Settings>) => new FolderInSettingValidator(makeSettings(overrides));

describe("encryptAll", () => {
	test("encryptAll=true bypasses the folder list entirely and returns the validator", () => {
		const v = validatorFor({ encryptAll: true, foldersToEncrypt: [] });
		expect(v.validate("anything/at/all.md")).toBe(v);
		expect(v.validate("")).toBe(v);
		expect(v.validate("secret2/x.md")).toBe(v);
	});

	test("encryptAll=true even with foldersToEncrypt undefined (old data.json)", () => {
		const v = validatorFor({ encryptAll: true, foldersToEncrypt: undefined as unknown as string[] });
		expect(v.validate("note.md")).toBe(v);
	});
});

describe("folder matching (encryptAll=false)", () => {
	test("exact match with a configured entry passes", () => {
		const v = validatorFor({ foldersToEncrypt: ["secret"] });
		expect(v.validate("secret")).toBe(v);
	});

	test("a file directly inside the folder passes", () => {
		const v = validatorFor({ foldersToEncrypt: ["secret"] });
		expect(v.validate("secret/note.md")).toBe(v);
	});

	test("nested prefix match passes (any depth)", () => {
		const v = validatorFor({ foldersToEncrypt: ["secret"] });
		expect(v.validate("secret/nested/deep/note.md")).toBe(v);
	});

	test("second configured folder is consulted too", () => {
		const v = validatorFor({ foldersToEncrypt: ["work", "secret"] });
		expect(v.validate("secret/note.md")).toBe(v);
		expect(v.validate("work/todo.md")).toBe(v);
	});

	test("sibling-prefix lookalike (\"secret2/x.md\" vs folder \"secret\") throws", () => {
		const v = validatorFor({ foldersToEncrypt: ["secret"] });
		expect(() => v.validate("secret2/x.md")).toThrow(ValidationError);
		expect(() => v.validate("secretive.md")).toThrow(ValidationError);
		expect(() => v.validate("secret.md")).toThrow(ValidationError);
	});

	test("a file outside every configured folder throws", () => {
		const v = validatorFor({ foldersToEncrypt: ["secret", "work"] });
		expect(() => v.validate("other/note.md")).toThrow(ValidationError);
		expect(() => v.validate("note.md")).toThrow(ValidationError);
	});

	test("matching is by path segment, not by substring", () => {
		const v = validatorFor({ foldersToEncrypt: ["secret"] });
		expect(() => v.validate("other/secret/note.md")).toThrow(ValidationError); // parent differs
		expect(() => v.validate("mysecret/note.md")).toThrow(ValidationError);
	});
});

describe("path normalisation", () => {
	test("leading/trailing slashes on the configured folder are ignored", () => {
		expect(validatorFor({ foldersToEncrypt: ["/secret/"] }).validate("secret/note.md")).toBeTruthy();
		expect(validatorFor({ foldersToEncrypt: ["secret/"] }).validate("secret/note.md")).toBeTruthy();
		expect(validatorFor({ foldersToEncrypt: ["/secret"] }).validate("secret/nested/note.md")).toBeTruthy();
	});

	test("leading slash / doubled slashes on the file path are ignored", () => {
		const v = validatorFor({ foldersToEncrypt: ["secret"] });
		expect(v.validate("/secret/note.md")).toBe(v);
		expect(v.validate("secret//note.md")).toBe(v);
		expect(v.validate("//secret///nested//note.md")).toBe(v);
	});

	test("backslashes (Windows-style) are normalised on both sides", () => {
		expect(validatorFor({ foldersToEncrypt: ["secret\\sub"] }).validate("secret/sub/note.md")).toBeTruthy();
		expect(validatorFor({ foldersToEncrypt: ["secret/sub"] }).validate("secret\\sub\\note.md")).toBeTruthy();
		expect(validatorFor({ foldersToEncrypt: ["secret\\sub\\"] }).validate("secret\\sub\\note.md")).toBeTruthy();
	});

	test("normalisation does not create false positives", () => {
		const v = validatorFor({ foldersToEncrypt: ["/secret/"] });
		expect(() => v.validate("/secret2/note.md")).toThrow(ValidationError);
		expect(() => v.validate("\\secretive\\note.md")).toThrow(ValidationError);
	});

	test("the folder path itself only matches when passed literally (quirk: exact match is un-normalised)", () => {
		const v = validatorFor({ foldersToEncrypt: ["secret"] });
		expect(v.validate("secret")).toBe(v);
		// "secret/" normalises to "secret", which neither equals "secret" literally nor starts with "secret/"
		expect(() => v.validate("secret/")).toThrow(ValidationError);
		expect(() => v.validate("/secret")).toThrow(ValidationError);
	});

	// Potential new finding (not in REVIEW-FINDINGS): normalizePath("/") === "/" and normalizePath("") === "/",
	// so the prefix check becomes startsWith("//"), which no vault path satisfies. An empty entry (the
	// settings tab pushes "" when "add folder" is clicked) or the vault root therefore never matches — safe
	// for "" but means "/" cannot be used to opt the root folder in. Documents current behaviour.
	test("an empty entry or the vault root \"/\" in foldersToEncrypt never matches (documents current behaviour)", () => {
		expect(() => validatorFor({ foldersToEncrypt: [""] }).validate("note.md")).toThrow(ValidationError);
		expect(() => validatorFor({ foldersToEncrypt: ["/"] }).validate("note.md")).toThrow(ValidationError);
		expect(() => validatorFor({ foldersToEncrypt: ["/"] }).validate("secret/note.md")).toThrow(ValidationError);
	});
});

describe("empty / missing folder list", () => {
	// F01 root cause: main.ts (hookedAdapterWrite) runs this validator BEFORE deciding how to write an
	// already-encrypted note. With the defaults (encryptAll=false, foldersToEncrypt=[]) `[].some(...)` is
	// false → ValidationError → the caller's catch swallows it and falls through to a PLAINTEXT write.
	test("empty folder list throws (F01 root cause: main.ts calls this before re-encrypting)", () => {
		const v = validatorFor({ encryptAll: false, foldersToEncrypt: [] });
		expect(() => v.validate("Encrypted.md")).toThrow(ValidationError);
		expect(() => v.validate("secret/Encrypted.md")).toThrow(ValidationError);
	});

	test("undefined foldersToEncrypt (old data.json without the key) does not crash — it throws ValidationError like an empty list", () => {
		const v = validatorFor({ encryptAll: false, foldersToEncrypt: undefined as unknown as string[] });
		// optional chaining: `undefined?.some(...)` → undefined → falsy → ValidationError (no TypeError)
		expect(() => v.validate("note.md")).toThrow(ValidationError);
		expect(() => v.validate("note.md")).not.toThrow(TypeError);
	});
});

describe("ValidationError", () => {
	test("carries objectName, displayError and a message naming the path", () => {
		const v = validatorFor({ foldersToEncrypt: ["secret"] });
		let caught: unknown;
		try {
			v.validate("other/note.md");
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ValidationError);
		expect(caught).toBeInstanceOf(Error);
		const err = caught as ValidationError;
		expect(err.objectName).toBe("FolderInSettingValidator");
		expect(err.displayError).toBe("This folder isn't in your path.");
		expect(err.message).toBe("other/note.md folder not in path, ignoring.");
	});
});
