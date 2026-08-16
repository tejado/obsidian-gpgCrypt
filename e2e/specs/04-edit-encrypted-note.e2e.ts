/**
 * THE data-safety invariant, end to end: after editing an encrypted note in real Obsidian, the file
 * on disk must still be an OpenPGP message and must decrypt to the edited content.
 *
 * With the DEFAULT settings this is currently broken (F01, upstream #51/#60) — encoded with itKnownBug so
 * the suite stays green until the fix lands and then reminds the developer to un-mark it.
 */
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import {
	CANARY,
	PRESETS,
	activeEditorText,
	decryptWithPlugin,
	diskRead,
	expectCiphertextOnDisk,
	expectPlaintextOnDisk,
	isArmoredMessage,
	resetWithSettings,
	waitForDisk,
} from "../helpers/plugin.js";
import { itKnownBug } from "../helpers/known-bug.js";

async function openDecrypted(path: string): Promise<void> {
	expectCiphertextOnDisk(path); // the fixture must really be encrypted before we start
	await obsidianPage.openFile(path);
	await browser.waitUntil(async () => (await activeEditorText())?.includes("Hello secret world") ?? false, {
		timeout: 10_000,
		timeoutMsg: `${path} was not decrypted into the editor`,
	});
}

/** Edit through Vault.modify (deterministic; same adapter path Obsidian's editor uses to save). */
async function modifyActive(path: string, content: string): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, path, content) => {
			const file = app.vault.getFileByPath(path)!;
			await app.vault.modify(file, content);
		},
		path,
		content,
	);
}

async function assertEncryptedWith(path: string, expected: string): Promise<void> {
	const onDisk = await waitForDisk(path, (c) => c !== undefined && c !== "" && !c.includes(expected), 5_000).catch(() => diskRead(path));
	if (!isArmoredMessage(onDisk)) {
		throw new Error(`expected ciphertext on disk for ${path}, got: ${JSON.stringify(onDisk?.slice(0, 60))}`);
	}
	expect(await decryptWithPlugin(onDisk!)).toBe(expected);
}

describe("04 editing an encrypted note keeps it encrypted on disk", function () {
	// F01 — default settings
	itKnownBug("F01", "DEFAULT settings: Encrypted.md stays ciphertext after an edit", async function () {
		await resetWithSettings(PRESETS.default);
		await openDecrypted("Encrypted.md");
		await modifyActive("Encrypted.md", `${CANARY.edit}\n`);
		await assertEncryptedWith("Encrypted.md", `${CANARY.edit}\n`);
	});

	itKnownBug("F01", "DEFAULT settings: Encrypted.gpg stays ciphertext after an edit", async function () {
		await resetWithSettings(PRESETS.default);
		await openDecrypted("Encrypted.gpg");
		await modifyActive("Encrypted.gpg", `${CANARY.edit}\n`);
		await assertEncryptedWith("Encrypted.gpg", `${CANARY.edit}\n`);
	});

	itKnownBug("F01", "folders=[secret]: an encrypted note OUTSIDE the folder stays ciphertext after an edit", async function () {
		await resetWithSettings(PRESETS.folders);
		await openDecrypted("Encrypted.md");
		await modifyActive("Encrypted.md", `${CANARY.edit}\n`);
		await assertEncryptedWith("Encrypted.md", `${CANARY.edit}\n`);
	});

	it("encryptAll=true: Encrypted.md stays ciphertext after an edit", async function () {
		await resetWithSettings(PRESETS.encryptAll);
		await openDecrypted("Encrypted.md");
		await modifyActive("Encrypted.md", `${CANARY.edit}\n`);
		await assertEncryptedWith("Encrypted.md", `${CANARY.edit}\n`);
	});

	it("encryptAll=true: typing into the editor is saved as ciphertext", async function () {
		await resetWithSettings(PRESETS.encryptAll);
		await openDecrypted("Encrypted.md");
		await browser.executeObsidian(({ app, obsidian }, text) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
			view.editor.setValue(text);
		}, `${CANARY.typed}\n`);
		// Obsidian debounces saves (~2 s); force one via the view's save if available, else wait.
		await browser.executeObsidian(async ({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView) as any;
			if (view?.save) await view.save();
		});
		await assertEncryptedWith("Encrypted.md", `${CANARY.typed}\n`);
	});

	it("encryptAll=true: a brand new plaintext note becomes ciphertext on first save", async function () {
		await resetWithSettings(PRESETS.encryptAll);
		await browser.executeObsidian(async ({ app }, text) => {
			await app.vault.create("New.md", text);
		}, `${CANARY.edit}\n`);
		// create() bypasses the encrypt branch (no TFile yet); the next modify must encrypt
		await modifyActive("New.md", `${CANARY.edit} v2\n`);
		await assertEncryptedWith("New.md", `${CANARY.edit} v2\n`);
	});

	it("folders=[secret]: a note inside the folder becomes ciphertext on save; a note outside stays plaintext", async function () {
		await resetWithSettings(PRESETS.folders);
		expectPlaintextOnDisk("secret/InFolder.md");
		expectPlaintextOnDisk("other/Outside.md");
		await modifyActive("secret/InFolder.md", `${CANARY.edit} in folder\n`);
		await assertEncryptedWith("secret/InFolder.md", `${CANARY.edit} in folder\n`);

		await modifyActive("other/Outside.md", "outside stays plain\n");
		await browser.pause(500);
		expect(diskRead("other/Outside.md")).toBe("outside stays plain\n");
	});
});
