/**
 * Smoke test — the minimum that must hold on every Obsidian version in the matrix:
 * plugin loads, registers its commands and status bar item, and produces no console errors.
 */
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { F10_MESSAGE, PLUGIN_ID, installErrorCollector, isPluginEnabled, pluginErrors, pluginErrorsUnfiltered, resetWithSettings } from "../helpers/plugin.js";
import { statusBarItem } from "../helpers/ui.js";
import { itKnownBug } from "../helpers/known-bug.js";

describe("00 smoke", function () {
	before(async function () {
		await resetWithSettings();
	});

	it("reports the Obsidian version under test", async function () {
		const app = browser.getObsidianVersion();
		const installer = browser.getObsidianInstallerVersion();
		const platform = await obsidianPage.getPlatform();
		console.log(`    Obsidian app ${app} / installer ${installer} / mobile=${platform.isMobile}`);
		expect(app).toMatch(/^\d+\.\d+\.\d+/);
	});

	it("plugin is enabled and its manifest version matches the built dist", async function () {
		expect(await isPluginEnabled()).toBe(true);
		const info = await browser.executeObsidian(({ app }, id) => {
			const p = (app as any).plugins.plugins[id];
			return { version: p?.manifest?.version, id: p?.manifest?.id };
		}, PLUGIN_ID);
		expect(info.id).toBe(PLUGIN_ID);
		expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
	});

	it("registers both commands", async function () {
		const ids = await browser.executeObsidian(
			({ app }, id) => Object.keys((app as any).commands.commands).filter((c) => c.startsWith(`${id}:`)),
			PLUGIN_ID,
		);
		expect(ids).toContain("gpg-crypt:gpg-encrypt-permanently");
		expect(ids).toContain("gpg-crypt:gpg-decrypt-permanently");
	});

	it("adds a status bar item (hidden until an encrypted note is active)", async function () {
		const platform = await obsidianPage.getPlatform();
		if (platform.isMobile) this.skip(); // Obsidian mobile has no status bar
		await expect(statusBarItem()).toExist();
	});

	it("registers .gpg as a markdown extension", async function () {
		const viewType = await browser.executeObsidian(({ app }) => (app as any).viewRegistry.getTypeByExtension("gpg"));
		expect(viewType).toBe("markdown");
	});

	it("produced no plugin-related console errors during startup", async function () {
		expect(await pluginErrors()).toEqual([]);
	});

	// F10 — spawnGPG.ts imports child_process at module scope although manifest.isDesktopOnly is false.
	// Obsidian's mobile `require` shim logs an error for that on every plugin load (visible under emulateMobile).
	itKnownBug("F10", "loading the plugin on (emulated) mobile does not try to require Node packages", async function () {
		const platform = await obsidianPage.getPlatform();
		if (!platform.isMobile) this.skip(); // desktop: Node is available, nothing to observe
		await obsidianPage.disablePlugin(PLUGIN_ID);
		await installErrorCollector();
		await obsidianPage.enablePlugin(PLUGIN_ID);
		const errs = await pluginErrorsUnfiltered();
		expect(errs.filter((e) => e.includes(F10_MESSAGE))).toEqual([]);
	});

	it("desktop: enabling the plugin logs no console errors at all", async function () {
		const platform = await obsidianPage.getPlatform();
		if (platform.isMobile) this.skip();
		await obsidianPage.disablePlugin(PLUGIN_ID);
		await installErrorCollector();
		await obsidianPage.enablePlugin(PLUGIN_ID);
		expect(await pluginErrorsUnfiltered()).toEqual([]);
	});
});
