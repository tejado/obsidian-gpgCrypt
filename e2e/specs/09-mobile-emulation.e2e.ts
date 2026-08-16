/**
 * Mobile-specific UX (only meaningful under the emulateMobile capabilities): the backend selector is
 * locked to OpenPGP.js, the welcome text mentions the limitation, and encrypt/decrypt still work.
 * NOTE: emulation still runs on Electron (Node APIs present) — it cannot reproduce Capacitor-only crashes.
 */
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { PRESETS, activeEditorText, decryptWithPlugin, expectPlaintextOnDisk, isArmoredMessage, pluginErrors, resetWithSettings, waitForDisk } from "../helpers/plugin.js";
import { clickButtonByText, closeSettings, lastModal, openSettingsTab, settingRow } from "../helpers/ui.js";

describe("09 mobile emulation", function () {
	before(async function () {
		const platform = await obsidianPage.getPlatform();
		if (!platform.isMobile) this.skip();
	});

	beforeEach(async function () {
		await resetWithSettings(PRESETS.default);
	});

	it("the plugin reports the mobile platform and loads without errors", async function () {
		const isMobile = await browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile);
		expect(isMobile).toBe(true);
		expect(await pluginErrors()).toEqual([]);
	});

	it("settings: backend dropdown is locked to OpenPGP.js", async function () {
		await openSettingsTab();
		const select = await (await settingRow("Encryption backend")).$("select");
		const info = await browser.execute(
			(el) => ({ disabled: (el as HTMLSelectElement).disabled, options: Array.from((el as HTMLSelectElement).options).map((o) => o.value) }),
			select as unknown as HTMLElement,
		);
		expect(info).toEqual({ disabled: true, options: ["native"] });
		await closeSettings();
	});

	it("welcome dialog mentions that the CLI wrapper is unavailable on mobile", async function () {
		await openSettingsTab();
		await (await settingRow("Show welcome dialog")).$("button").click();
		await browser.$("h2*=Welcome to gpgCrypt").waitForExist({ timeout: 10_000 });
		const text = await lastModal().getText();
		expect(text).toContain("not supported on mobile devices");
		await clickButtonByText("Close");
		await closeSettings();
	});

	it("encrypt / open / decrypt round trip works", async function () {
		expectPlaintextOnDisk("Plain.md", "This note is not encrypted.");
		await obsidianPage.openFile("Plain.md");
		await browser.executeObsidianCommand("gpg-crypt:gpg-encrypt-permanently");
		const ct = await waitForDisk("Plain.md", isArmoredMessage);
		expect(await decryptWithPlugin(ct!)).toContain("This note is not encrypted.");
		expect(await activeEditorText()).toContain("This note is not encrypted.");
		await browser.executeObsidianCommand("gpg-crypt:gpg-decrypt-permanently");
		await waitForDisk("Plain.md", (c) => !!c && c.includes("This note is not encrypted."));
	});
});
