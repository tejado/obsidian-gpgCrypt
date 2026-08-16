/**
 * Disable/enable cycles: hooks are removed and re-installed cleanly, no "Inconsistent plugin unload"
 * dialog, encrypted notes read as ciphertext while disabled and as plaintext when enabled.
 */
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { PLUGIN_ID, PRESETS, isPluginEnabled, pluginErrors, resetWithSettings } from "../helpers/plugin.js";
import { modalExists } from "../helpers/ui.js";

async function adapterRead(path: string): Promise<string> {
	return browser.executeObsidian(({ app }, p) => app.vault.adapter.read(p), path);
}

describe("06 unload / reload cycles", function () {
	before(async function () {
		await resetWithSettings(PRESETS.default);
	});

	it("survives three disable/enable cycles", async function () {
		for (let i = 0; i < 3; i++) {
			await obsidianPage.disablePlugin(PLUGIN_ID);
			expect(await isPluginEnabled()).toBe(false);
			expect(await modalExists("Inconsistent plugin unload")).toBe(false);
			// hooks gone: the adapter now returns the ciphertext
			expect((await adapterRead("Encrypted.md")).startsWith("-----BEGIN PGP MESSAGE-----")).toBe(true);

			await obsidianPage.enablePlugin(PLUGIN_ID);
			expect(await isPluginEnabled()).toBe(true);
			// hooks back: the adapter decrypts
			await browser.waitUntil(async () => (await adapterRead("Encrypted.md")).includes("Hello secret world"), {
				timeout: 10_000,
				timeoutMsg: `cycle ${i}: adapter.read did not decrypt after re-enable`,
			});
		}
		expect(await pluginErrors()).toEqual([]);
	});

	it("after re-enabling, the plugin's hooks are the active adapter functions again", async function () {
		const names = await browser.executeObsidian(({ app }) => ({
			read: (app.vault.adapter.read as (...args: unknown[]) => unknown).name,
			write: (app.vault.adapter.write as (...args: unknown[]) => unknown).name,
		}));
		expect(names.read).toBe("bound hookedAdapterRead");
		expect(names.write).toBe("bound hookedAdapterWrite");
	});
});
