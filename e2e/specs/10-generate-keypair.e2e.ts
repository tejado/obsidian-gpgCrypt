/**
 * Key generation from the settings tab: modal → files on disk → settings updated → the new key works.
 */
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { PRESETS, diskExists, diskRead, expectPlaintextOnDisk, isArmoredMessage, readPluginData, resetWithSettings, waitForDisk } from "../helpers/plugin.js";
import { clickButtonByText, closeSettings, lastModal, modalExists, openSettingsTab, settingRow, waitForNotice } from "../helpers/ui.js";

const KEYPAIR_MODAL_TEXT = "Generate a new key pair with gpgCrypt";

describe("10 generate key pair", function () {
	beforeEach(async function () {
		await resetWithSettings(PRESETS.default);
	});

	it("generates a passphrase-protected key pair into the vault and switches the settings to it", async function () {
		expect(diskExists("gen-pub.asc")).toBe(false);
		expectPlaintextOnDisk("Plain.md");
		await openSettingsTab();
		await (await settingRow("Public key")).$("button*=Generate new key pair").click();
		// the settings tab is itself a .modal-container → wait for the key pair modal and take the newest modal
		await browser.waitUntil(() => modalExists(KEYPAIR_MODAL_TEXT), { timeout: 10_000, timeoutMsg: "key pair modal not shown" });
		const modal = lastModal();
		const inputs = await modal.$$(".setting-item input");
		expect(inputs.length).toBe(6);
		// name, email, public, private, passphrase, confirm
		await inputs[2].setValue("gen-pub.asc");
		await inputs[3].setValue("gen-priv.asc");
		await inputs[4].setValue("hunter2");
		await inputs[5].setValue("hunter2");
		await clickButtonByText("Generate Key Pair");
		await waitForNotice("Key pair successfully created!", 60_000);

		await waitForDisk("gen-pub.asc", (c) => !!c && c.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----"));
		expect(diskRead("gen-priv.asc")).toContain("-----BEGIN PGP PRIVATE KEY BLOCK-----");
		expect(readPluginData().backendNative).toEqual({ publicKeyPath: "gen-pub.asc", privateKeyPath: "gen-priv.asc" });
		await closeSettings();

		// the new (passphrase-protected) key is active: encrypting works, decrypting prompts
		await obsidianPage.openFile("Plain.md");
		await browser.executeObsidianCommand("gpg-crypt:gpg-encrypt-permanently");
		await waitForDisk("Plain.md", isArmoredMessage);
	});

	it("refuses to overwrite existing key files", async function () {
		await openSettingsTab();
		await (await settingRow("Public key")).$("button*=Generate new key pair").click();
		await browser.waitUntil(() => modalExists(KEYPAIR_MODAL_TEXT), { timeout: 10_000, timeoutMsg: "key pair modal not shown" });
		// defaults are public.asc / private.asc which already exist in the vault
		await clickButtonByText("Generate Key Pair");
		await waitForNotice("already existing");
		expect(readPluginData().backendNative.publicKeyPath).toBe("public.asc");
		await closeSettings();
	});
});
