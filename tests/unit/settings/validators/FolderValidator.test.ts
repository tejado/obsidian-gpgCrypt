/**
 * FolderValidator (src/settings/validators/ValidateFolderPath.ts) — checks that a folder exists in the
 * vault. It reads the static `GpgPlugin.APP` (see REVIEW-FINDINGS "Testability refactors" #4), so the
 * test installs a fake App there.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import GpgPlugin from "src/main";
import { FolderValidator } from "src/settings/validators/ValidateFolderPath";
import { ValidationError } from "src/settings/validators/IValidator";
import { createFakeApp } from "../../../mocks/fake-app";

describe("FolderValidator", () => {
	let savedApp: unknown;

	beforeEach(() => {
		savedApp = GpgPlugin.APP;
		GpgPlugin.APP = createFakeApp({ folders: ["exists", "exists/nested", "with space"] }) as any;
	});

	afterEach(() => {
		GpgPlugin.APP = savedApp as any;
	});

	test("an existing folder passes and returns the validator (chainable)", () => {
		const v = new FolderValidator();
		expect(v.validate("exists")).toBe(v);
		expect(v.validate("exists/nested")).toBe(v);
		expect(v.validate("with space")).toBe(v);
	});

	test("path normalisation is delegated to the vault (leading/trailing slashes, backslashes)", () => {
		const v = new FolderValidator();
		expect(v.validate("/exists/")).toBe(v);
		expect(v.validate("exists\\nested")).toBe(v);
	});

	test("the vault root resolves as a folder", () => {
		const v = new FolderValidator();
		expect(v.validate("/")).toBe(v);
	});

	test("a missing folder throws ValidationError with the display text", () => {
		const v = new FolderValidator();
		let caught: unknown;
		try {
			v.validate("missing");
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ValidationError);
		const err = caught as ValidationError;
		expect(err.objectName).toBe("Folder");
		expect(err.displayError).toBe("This Folder doesn't seem to exist in your Obsidian Vault");
		expect(err.message).toBe("missing - file-not-found");
	});

	test("a file path is not a folder", () => {
		GpgPlugin.APP = createFakeApp({ files: { "exists/note.md": "x" } }) as any;
		expect(() => new FolderValidator().validate("exists/note.md")).toThrow(ValidationError);
		expect(new FolderValidator().validate("exists")).toBeTruthy(); // parent folder created by the seed
	});
});
