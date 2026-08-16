/**
 * Settings tab UX in real Obsidian: it renders, every setting row is present, toggles persist to
 * data.json, backend switching shows/hides the right groups.
 */
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { PRESETS, pluginErrors, readPluginData, resetWithSettings } from "../helpers/plugin.js";
import { clickButtonByText, clickToggle, closeSettings, openSettingsTab, settingNames, settingRow, settingVisible } from "../helpers/ui.js";

const NATIVE_ROWS = ["Public key", "Private key", "Ask passphrase on startup", "Remember passphrase", "Restart passphrase timeout on save"];
const WRAPPER_ROWS = ["GPG executable", "Always trust keys", "Use compression", "Cache decrypted notes", "Key ID / Recipient", "Show decryption dialog"];

describe("02 settings tab", function () {
	beforeEach(async function () {
		await resetWithSettings(PRESETS.default);
		await openSettingsTab();
	});

	afterEach(async function () {
		await closeSettings();
		expect(await pluginErrors()).toEqual([]);
	});

	it("renders all setting rows in order", async function () {
		const names = await settingNames();
		const expected = [
			"Encrypt all notes",
			"Encrypt Folders",
			"Use .gpg file extension",
			"File recovery format for encrypted notes",
			"Compatibility mode",
			"Encryption Backend",
			"Encryption backend",
			...NATIVE_ROWS,
			...WRAPPER_ROWS,
			"About",
			"Show welcome dialog",
			"Learn more",
		];
		for (const name of expected) expect(names).toContain(name);
		// order of the first rows is stable
		expect(names.slice(0, 5)).toEqual(expected.slice(0, 5));
	});

	it("native backend selected: native rows visible, wrapper rows hidden", async function () {
		for (const n of NATIVE_ROWS) expect(await settingVisible(n)).toBe(true);
		for (const n of WRAPPER_ROWS) expect(await settingVisible(n)).toBe(false);
	});

	it("toggling 'Encrypt all notes' persists to data.json (and back)", async function () {
		expect(readPluginData().encryptAll).toBe(false);
		await clickToggle("Encrypt all notes");
		await browser.waitUntil(() => readPluginData().encryptAll === true, { timeout: 5_000, timeoutMsg: "encryptAll not persisted" });
		await clickToggle("Encrypt all notes");
		await browser.waitUntil(() => readPluginData().encryptAll === false, { timeout: 5_000 });
	});

	it("toggling 'Use .gpg file extension' persists", async function () {
		await clickToggle("Use .gpg file extension");
		await browser.waitUntil(() => readPluginData().renameToGpg === true, { timeout: 5_000 });
	});

	it("file recovery dropdown offers encrypted / plaintext / skip and persists", async function () {
		const row = await settingRow("File recovery format for encrypted notes");
		const select = await row.$("select");
		const values = await browser.execute((el) => Array.from((el as HTMLSelectElement).options).map((o) => o.value), select as unknown as HTMLElement);
		expect(values).toEqual(["encrypted", "plaintext", "skip"]);
		await select.selectByAttribute("value", "skip");
		await browser.waitUntil(() => readPluginData().fileRecovery === "skip", { timeout: 5_000 });
	});

	it("switching the backend to GnuPG CLI Wrapper shows the wrapper rows and hides the native rows (desktop only)", async function () {
		const platform = await obsidianPage.getPlatform();
		if (platform.isMobile) this.skip();
		const row = await settingRow("Encryption backend");
		await row.$("select").selectByAttribute("value", "wrapper");
		await browser.waitUntil(async () => settingVisible("GPG executable"), { timeout: 5_000, timeoutMsg: "wrapper rows not shown" });
		for (const n of WRAPPER_ROWS) expect(await settingVisible(n)).toBe(true);
		for (const n of NATIVE_ROWS) expect(await settingVisible(n)).toBe(false);
		await browser.waitUntil(() => readPluginData().backend === "wrapper", { timeout: 5_000 });
		// The executable status line is rendered ASYNCHRONOUSLY: SettingsTab.checkGpgExecutable awaits
		// `gpg --version` (isGPG) and only then rewrites the description. Wait for it — found or not,
		// depending on the machine (spawning gpg takes hundreds of ms on the Windows runners).
		const descEl = (await settingRow("GPG executable")).$(".setting-item-description");
		await browser.waitUntil(async () => (await descEl.getText()).includes("Status:"), {
			timeout: 15_000,
			timeoutMsg: "no 'Status:' line under 'GPG executable' — checkGpgExecutable never resolved",
		});
		console.log(`    ${(await descEl.getText()).split("\n").find((l) => l.startsWith("Status:"))}`);
	});

	it("on emulated mobile the backend dropdown only offers OpenPGP.js and is disabled", async function () {
		const platform = await obsidianPage.getPlatform();
		if (!platform.isMobile) this.skip();
		const row = await settingRow("Encryption backend");
		const select = await row.$("select");
		const info = await browser.execute(
			(el) => ({ disabled: (el as HTMLSelectElement).disabled, options: Array.from((el as HTMLSelectElement).options).map((o) => o.value) }),
			select as unknown as HTMLElement,
		);
		expect(info.disabled).toBe(true);
		expect(info.options).toEqual(["native"]);
	});

	it("'Show welcome dialog' opens the welcome modal", async function () {
		const row = await settingRow("Show welcome dialog");
		await row.$("button").click();
		const modal = browser.$("h2*=Welcome to gpgCrypt");
		await expect(modal).toExist();
		await clickButtonByText("Close"); // the LAST "Close" button = the welcome modal's (settings modal is underneath)
		await modal.waitForExist({ reverse: true, timeout: 5_000 }); // mobile closes modals with a transition
	});
});
