/**
 * The single most important invariant of gpgCrypt: whatever Obsidian writes through the (hooked)
 * adapter for a note that is (or must become) encrypted must reach the disk as an OpenPGP message —
 * never as plaintext. Exercised across the settings that steer `hookedAdapterWrite` (main.ts:454-509).
 */
import { afterEach, describe, expect, test } from "vitest";
import { Modal, Notice } from "obsidian";
import { createPluginHarness, flush, type Harness } from "../helpers/plugin-harness";
import { CIPHERTEXT_NOPASS, isArmoredMessage } from "../helpers/fixtures";
import DialogModal from "src/modals/DialogModal";

let h: Harness | undefined;
afterEach(async () => {
	await h?.unload();
	h = undefined;
});

async function decryptDisk(harness: Harness, path: string): Promise<string> {
	return harness.plugin.gpgNative.decrypt(harness.disk(path)!, null);
}

describe("hookedAdapterWrite keeps encrypted notes encrypted", () => {
	// F01: with the default settings (no "encrypt all", no folders)
	// FolderInSettingValidator throws before the re-encrypt branch and the plaintext falls through
	// to originalWrite (main.ts:476-508). Upstream issues #51 / #60.
	test.fails("[F01] editing an already-encrypted note with DEFAULT settings keeps ciphertext on disk", async () => {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS } });
		const file = h.app.vault.getFileByPath("Encrypted.md")!;

		// Obsidian opens the note (read through the hook → decrypts, records status)
		expect(await h.app.vault.read(file)).toBe("Hello secret world\n");

		// The user edits and Obsidian saves the plaintext through the adapter
		await h.app.vault.modify(file, "edited secret\n");

		expect(isArmoredMessage(h.disk("Encrypted.md"))).toBe(true);
		expect(await decryptDisk(h, "Encrypted.md")).toBe("edited secret\n");
	});

	test("editing an already-encrypted note with encryptAll=true keeps ciphertext on disk", async () => {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS }, settings: { encryptAll: true } });
		const file = h.app.vault.getFileByPath("Encrypted.md")!;
		await h.app.vault.read(file);
		await h.app.vault.modify(file, "edited secret\n");

		expect(isArmoredMessage(h.disk("Encrypted.md"))).toBe(true);
		expect(await decryptDisk(h, "Encrypted.md")).toBe("edited secret\n");
	});

	test("editing an already-encrypted note inside a configured folder keeps ciphertext on disk", async () => {
		h = await createPluginHarness({
			files: { "secret/Encrypted.md": CIPHERTEXT_NOPASS },
			settings: { foldersToEncrypt: ["secret"] },
		});
		const file = h.app.vault.getFileByPath("secret/Encrypted.md")!;
		await h.app.vault.read(file);
		await h.app.vault.modify(file, "edited in folder\n");

		expect(isArmoredMessage(h.disk("secret/Encrypted.md"))).toBe(true);
		expect(await decryptDisk(h, "secret/Encrypted.md")).toBe("edited in folder\n");
	});

	// Same root cause as F01, second symptom: an encrypted note that lives OUTSIDE the configured
	// folders is decrypted on disk by the next save.
	test.fails("[F01] editing an encrypted note OUTSIDE the configured folders keeps ciphertext on disk", async () => {
		h = await createPluginHarness({
			files: { "other/Encrypted.md": CIPHERTEXT_NOPASS },
			settings: { foldersToEncrypt: ["secret"] },
		});
		const file = h.app.vault.getFileByPath("other/Encrypted.md")!;
		await h.app.vault.read(file);
		await h.app.vault.modify(file, "edited outside folder\n");

		expect(isArmoredMessage(h.disk("other/Encrypted.md"))).toBe(true);
	});
});

describe("hookedAdapterWrite: encryptAll / folder scoping for plaintext notes", () => {
	test("encryptAll=true: saving a plaintext note encrypts it on disk", async () => {
		h = await createPluginHarness({ files: { "Plain.md": "hello\n" }, settings: { encryptAll: true } });
		const file = h.app.vault.getFileByPath("Plain.md")!;
		await h.app.vault.modify(file, "now secret\n");

		expect(isArmoredMessage(h.disk("Plain.md"))).toBe(true);
		expect(await decryptDisk(h, "Plain.md")).toBe("now secret\n");
	});

	test("foldersToEncrypt: notes inside the folder (and nested) are encrypted, siblings/prefix-lookalikes are not", async () => {
		h = await createPluginHarness({
			files: {
				"secret/InFolder.md": "a\n",
				"secret/nested/Deep.md": "b\n",
				"other/Outside.md": "c\n",
				"secret2/Lookalike.md": "d\n",
				"secret.md": "e\n",
			},
			settings: { foldersToEncrypt: ["secret"] },
		});
		for (const p of ["secret/InFolder.md", "secret/nested/Deep.md", "other/Outside.md", "secret2/Lookalike.md", "secret.md"]) {
			await h.app.vault.modify(h.app.vault.getFileByPath(p)!, `edited ${p}\n`);
		}

		expect(isArmoredMessage(h.disk("secret/InFolder.md"))).toBe(true);
		expect(isArmoredMessage(h.disk("secret/nested/Deep.md"))).toBe(true);
		expect(h.disk("other/Outside.md")).toBe("edited other/Outside.md\n");
		expect(h.disk("secret2/Lookalike.md")).toBe("edited secret2/Lookalike.md\n");
		expect(h.disk("secret.md")).toBe("edited secret.md\n");
	});

	test("default settings: a plaintext note stays plaintext (encryption is opt-in per note)", async () => {
		h = await createPluginHarness({ files: { "Plain.md": "hello\n" } });
		const file = h.app.vault.getFileByPath("Plain.md")!;
		await h.app.vault.modify(file, "still plain\n");
		expect(h.disk("Plain.md")).toBe("still plain\n");
	});

	test("data that is already an OpenPGP message is written unchanged and tracked as encrypted", async () => {
		h = await createPluginHarness({ files: { "Note.md": "plain\n" }, settings: { encryptAll: true } });
		const file = h.app.vault.getFileByPath("Note.md")!;
		await h.app.vault.modify(file, CIPHERTEXT_NOPASS);
		expect(h.disk("Note.md")).toBe(CIPHERTEXT_NOPASS);
		// tracked as encrypted → "Decrypt permanently" is offered, "Encrypt" is not
		expect(h.plugin.commands__["gpg-crypt:gpg-encrypt-permanently"]).toBeDefined();
		h.app.workspace.setActiveFile__(file);
		expect(h.plugin.commands__["gpg-crypt:gpg-encrypt-permanently"].checkCallback!(true)).toBe(false);
		expect(h.plugin.commands__["gpg-crypt:gpg-decrypt-permanently"].checkCallback!(true)).toBe(true);
	});

	test("encryptAll=true does not touch files without a vault entry (e.g. plugin data.json)", async () => {
		h = await createPluginHarness({ settings: { encryptAll: true } });
		await h.app.vault.adapter.write(".obsidian/plugins/gpg-crypt/data.json", "{\"a\":1}");
		expect(h.disk(".obsidian/plugins/gpg-crypt/data.json")).toBe("{\"a\":1}");
	});
});

describe("hookedAdapterWrite: renameToGpg", () => {
	test("encrypting a .md note renames it to .gpg and writes ciphertext under the new path", async () => {
		h = await createPluginHarness({ files: { "Plain.md": "hello\n" }, settings: { encryptAll: true, renameToGpg: true } });
		const file = h.app.vault.getFileByPath("Plain.md")!;
		await h.app.vault.modify(file, "secret\n");

		expect(h.disk("Plain.md")).toBeUndefined();
		expect(isArmoredMessage(h.disk("Plain.gpg"))).toBe(true);
		expect(await decryptDisk(h, "Plain.gpg")).toBe("secret\n");
		expect(file.path).toBe("Plain.gpg");
	});

	test("an already .gpg note is not renamed again", async () => {
		h = await createPluginHarness({ files: { "Note.gpg": CIPHERTEXT_NOPASS }, settings: { encryptAll: true, renameToGpg: true } });
		const file = h.app.vault.getFileByPath("Note.gpg")!;
		await h.app.vault.read(file);
		await h.app.vault.modify(file, "secret2\n");
		expect(isArmoredMessage(h.disk("Note.gpg"))).toBe(true);
		expect(h.app.vault.getFileByPath("Note.gpg.gpg")).toBeNull();
	});
});

describe("hookedAdapterWrite: note modified outside of Obsidian (tracked encrypted, disk plaintext)", () => {
	async function externallyDecrypted(): Promise<{ file: ReturnType<Harness["app"]["vault"]["getFileByPath"]> }> {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS }, settings: { encryptAll: true } });
		const file = h.app.vault.getFileByPath("Encrypted.md")!;
		await h.app.vault.read(file); // status → encrypted
		h.app.vault.adapter.files.set("Encrypted.md", "changed outside\n"); // external tool decrypted it
		return { file };
	}

	test("user confirms → the note is re-encrypted", async () => {
		const { file } = await externallyDecrypted();
		const modify = h!.app.vault.modify(file!, "edited after external change\n");
		await flush();
		const dialog = Modal.opened__.find((m) => m instanceof DialogModal) as DialogModal;
		expect(dialog).toBeDefined();
		expect(dialog.contentEl.textContent).toContain("modified outside of Obsidian");
		(dialog.contentEl.querySelector("button.mod-cta") as HTMLButtonElement).click(); // Yes
		await modify;

		expect(isArmoredMessage(h!.disk("Encrypted.md"))).toBe(true);
		expect(await decryptDisk(h!, "Encrypted.md")).toBe("edited after external change\n");
	});

	test("user declines → plaintext is written, status flips to plaintext and a Notice is shown", async () => {
		const { file } = await externallyDecrypted();
		const modify = h!.app.vault.modify(file!, "kept plain\n");
		await flush();
		const dialog = Modal.opened__.find((m) => m instanceof DialogModal) as DialogModal;
		const buttons = Array.from(dialog.contentEl.querySelectorAll("button"));
		buttons.find((b) => b.textContent === "No")!.click();
		await modify;

		expect(h!.disk("Encrypted.md")).toBe("kept plain\n");
		expect(Notice.messages().some((m) => m.includes("will be saved in plaintext"))).toBe(true);
	});
});
