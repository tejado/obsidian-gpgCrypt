/**
 * First-run experience: the Welcome modal appears when firstLoad is true, "Skip" persists firstLoad=false,
 * "Open settings…" jumps to the plugin's settings tab.
 */
import { browser, expect } from "@wdio/globals";
import { PRESETS, readPluginData, resetWithSettings } from "../helpers/plugin.js";
import { activeSettingsTabId, clickButtonByText, closeSettings } from "../helpers/ui.js";

const WELCOME = "h2*=Welcome to gpgCrypt"; // WDIO partial-text selector (cannot be combined with CSS ancestors)

describe("07 first run", function () {
	it("shows the welcome modal on first load and 'Skip configuration' persists firstLoad=false", async function () {
		await resetWithSettings(PRESETS.firstRun);
		await browser.$(WELCOME).waitForExist({ timeout: 10_000 });
		// DOM click: on a phone-width viewport the welcome buttons overflow and a coordinate click can hit
		// the neighbouring "Generate new key pair..." button (mobile UX observation, see F36)
		await clickButtonByText("Skip configuration");
		await browser.$(WELCOME).waitForExist({ reverse: true, timeout: 5_000 }); // mobile closes modals with a transition
		await browser.waitUntil(() => readPluginData().firstLoad === false, { timeout: 5_000, timeoutMsg: "firstLoad not persisted" });
	});

	async function openSettingsFromWelcome(): Promise<void> {
		await resetWithSettings(PRESETS.firstRun);
		await browser.$(WELCOME).waitForExist({ timeout: 10_000 });
		await clickButtonByText("Open settings to use existing key pair...");
		await browser.waitUntil(async () => (await activeSettingsTabId()) === "gpg-crypt", { timeout: 10_000, timeoutMsg: "gpgCrypt settings tab not active" });
		await closeSettings();
	}

	it("'Open settings to use existing key pair…' opens the gpgCrypt settings tab", async function () {
		await openSettingsFromWelcome();
	});

	it("does not show the welcome modal again on the next start", async function () {
		await resetWithSettings(PRESETS.default);
		await browser.pause(1000);
		await expect(browser.$(WELCOME)).not.toExist();
	});
});
