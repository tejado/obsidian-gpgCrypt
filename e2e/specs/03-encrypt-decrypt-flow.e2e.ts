/**
 * Core UX flow: encrypt a note (command palette / context menu), verify ciphertext on disk while the
 * editor still shows plaintext, status bar lock icon, then decrypt permanently.
 */
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import {
	PRESETS,
	activeEditorText,
	decryptWithPlugin,
	diskExists,
	diskRead,
	expectCiphertextOnDisk,
	expectPlaintextOnDisk,
	isArmoredMessage,
	pluginErrors,
	resetWithSettings,
	waitForDisk,
} from "../helpers/plugin.js";
import { fileExplorerMenu, statusBarItem, waitForNotice } from "../helpers/ui.js";

async function commandAvailable(id: string): Promise<boolean> {
	return browser.executeObsidian(({ app }, id) => {
		const cmd = (app as any).commands.commands[id];
		return cmd?.checkCallback ? cmd.checkCallback(true) === true : !!cmd;
	}, id);
}

describe("03 encrypt / decrypt flow", function () {
	beforeEach(async function () {
		await resetWithSettings(PRESETS.default);
	});

	afterEach(async function () {
		expect(await pluginErrors()).toEqual([]);
	});

	it("'Encrypt file permanently' command (command palette): encrypts the active note on disk, editor keeps plaintext, status bar shows the lock", async function () {
		expectPlaintextOnDisk("Plain.md", "This note is not encrypted.");
		await obsidianPage.openFile("Plain.md");
		expect(await commandAvailable("gpg-crypt:gpg-encrypt-permanently")).toBe(true);
		expect(await commandAvailable("gpg-crypt:gpg-decrypt-permanently")).toBe(false);

		await browser.executeObsidianCommand("gpg-crypt:gpg-encrypt-permanently");
		const onDisk = await waitForDisk("Plain.md", isArmoredMessage);
		expect(await decryptWithPlugin(onDisk!)).toContain("This note is not encrypted.");

		// The editor still shows the plaintext
		expect(await activeEditorText()).toContain("This note is not encrypted.");

		// command availability flipped
		expect(await commandAvailable("gpg-crypt:gpg-encrypt-permanently")).toBe(false);
		expect(await commandAvailable("gpg-crypt:gpg-decrypt-permanently")).toBe(true);

		const platform = await obsidianPage.getPlatform();
		if (!platform.isMobile) {
			await browser.waitUntil(async () => statusBarItem().isDisplayed(), { timeout: 5_000, timeoutMsg: "status bar lock not shown" });
			await expect(statusBarItem()).toHaveAttribute("aria-label", "Encrypted with key pair");
		}
	});

	it("'Decrypt file permanently' command (command palette): restores plaintext on disk and hides the lock", async function () {
		expectCiphertextOnDisk("Encrypted.md");
		await obsidianPage.openFile("Encrypted.md");
		await browser.waitUntil(async () => (await activeEditorText())?.includes("Hello secret world") ?? false, {
			timeout: 10_000,
			timeoutMsg: "encrypted note was not decrypted into the editor",
		});
		expect(await commandAvailable("gpg-crypt:gpg-decrypt-permanently")).toBe(true);

		await browser.executeObsidianCommand("gpg-crypt:gpg-decrypt-permanently");
		// (a non-atomic write can be observed as an empty file for an instant → wait for the real content)
		const onDisk = await waitForDisk("Encrypted.md", (c) => !!c && c.includes("Hello secret world"));
		expect(isArmoredMessage(onDisk)).toBe(false);

		const platform = await obsidianPage.getPlatform();
		if (!platform.isMobile) {
			await browser.waitUntil(async () => !(await statusBarItem().isDisplayed()), { timeout: 5_000, timeoutMsg: "status bar lock still shown" });
		}
	});

	it("context menu: 'Encrypt with key pair' on a plaintext note in the file explorer", async function () {
		expectPlaintextOnDisk("Plain.md", "This note is not encrypted.");
		await fileExplorerMenu("Plain.md", "Encrypt with key pair");
		const onDisk = await waitForDisk("Plain.md", isArmoredMessage);
		expect(await decryptWithPlugin(onDisk!)).toContain("This note is not encrypted.");
	});

	it("context menu: 'Decrypt permanently' on an encrypted note", async function () {
		expectCiphertextOnDisk("Encrypted.md");
		await fileExplorerMenu("Encrypted.md", "Decrypt permanently");
		const onDisk = await waitForDisk("Encrypted.md", (c) => !!c && c.includes("Hello secret world"));
		expect(isArmoredMessage(onDisk)).toBe(false);
	});

	it("encrypting an already encrypted note reports 'already encrypted' and leaves the file untouched (guard, calls the plugin method directly)", async function () {
		expectCiphertextOnDisk("Encrypted.md");
		const before = diskRead("Encrypted.md");
		await obsidianPage.openFile("Encrypted.md");
		await browser.waitUntil(async () => (await activeEditorText())?.includes("Hello secret world") ?? false, { timeout: 10_000 });
		// the command hides itself for encrypted notes; call the plugin method directly to exercise the guard
		await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as any).plugins.plugins["gpg-crypt"];
			await plugin.persistentFileEncrypt(app.vault.getAbstractFileByPath("Encrypted.md"));
		});
		await waitForNotice("already encrypted");
		expect(diskRead("Encrypted.md")).toBe(before);
	});

	it("renameToGpg: encrypting Plain.md produces Plain.gpg (ciphertext) and removes Plain.md", async function () {
		await resetWithSettings(PRESETS.default, { renameToGpg: true });
		expectPlaintextOnDisk("Plain.md");
		expect(diskExists("Plain.gpg")).toBe(false);
		await obsidianPage.openFile("Plain.md");
		await browser.executeObsidianCommand("gpg-crypt:gpg-encrypt-permanently");
		await waitForDisk("Plain.gpg", isArmoredMessage);
		expect(diskExists("Plain.md")).toBe(false);
		expect(await decryptWithPlugin(diskRead("Plain.gpg")!)).toContain("This note is not encrypted.");

		// and back
		await browser.executeObsidianCommand("gpg-crypt:gpg-decrypt-permanently");
		await waitForDisk("Plain.md", (c) => !!c && c.includes("This note is not encrypted."));
		expect(diskExists("Plain.gpg")).toBe(false);
	});
});
