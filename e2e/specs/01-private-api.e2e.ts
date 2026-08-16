/**
 * Private-API drift canary. gpgCrypt monkey-patches documented AND undocumented Obsidian internals. 
 * This spec asserts, on every Obsidian version in the matrix, that the hooked members exist with 
 * the expected shape and that the plugin's hooks are (un)installed cleanly.
 * If Obsidian renames or restructures any of these, this is the first test to turn red.
 */
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { PLUGIN_ID, resetWithSettings } from "../helpers/plugin.js";

type Shape = Record<string, string>;

async function shape(): Promise<Shape> {
	return browser.executeObsidian(({ app, obsidian }) => {
		const a = app as any;
		const fr = a.internalPlugins?.plugins?.["file-recovery"];
		const name = (fn: unknown) => (typeof fn === "function" ? (fn as (...args: unknown[]) => unknown).name || "<anonymous>" : typeof fn);
		return {
			apiVersion: obsidian.apiVersion,
			"adapter.read": name(a.vault.adapter.read),
			"adapter.readBinary": name(a.vault.adapter.readBinary),
			"adapter.write": name(a.vault.adapter.write),
			"adapter.process": name(a.vault.adapter.process),
			"vault.cachedRead": name(a.vault.cachedRead),
			"internalPlugins.plugins": typeof a.internalPlugins?.plugins,
			"file-recovery.enabled": String(fr?.enabled),
			"file-recovery.instance": typeof fr?.instance,
			"file-recovery.onFileChanged": name(fr?.instance?.onFileChanged),
			"file-recovery.forceAdd": name(fr?.instance?.forceAdd),
			"setting.open": name(a.setting?.open),
			"setting.openTabById": name(a.setting?.openTabById),
			"fileManager.renameFile": name(a.fileManager.renameFile),
			"vault.getFolderByPath": name(a.vault.getFolderByPath),
			"vault.getAbstractFileByPath": name(a.vault.getAbstractFileByPath),
			"workspace.getActiveViewOfType": name(a.workspace.getActiveViewOfType),
			"viewRegistry.getTypeByExtension": name(a.viewRegistry?.getTypeByExtension),
			"vault.adapter.getResourcePath": name(a.vault.adapter.getResourcePath),
			"adapter.append": name(a.vault.adapter.append),
			"adapter.appendBinary": name(a.vault.adapter.appendBinary),
			"adapter.writeBinary": name(a.vault.adapter.writeBinary),
		};
	});
}

describe("01 private API surface (drift canary)", function () {
	before(async function () {
		await resetWithSettings();
	});

	it("all internals the plugin patches exist while the plugin is enabled, and are the plugin's bound hooks", async function () {
		const s = await shape();
		console.log(`    obsidian.apiVersion = ${s.apiVersion}`);

		// undocumented internals
		expect(s["internalPlugins.plugins"]).toBe("object");
		expect(s["file-recovery.enabled"]).toBe("true");
		expect(s["file-recovery.instance"]).toBe("object");
		expect(s["file-recovery.onFileChanged"]).toBe("bound hookedFileRecoveryOnFileChange");
		expect(s["file-recovery.forceAdd"]).toBe("bound hookedFileRecoveryForceAdd");
		expect(s["setting.open"]).not.toBe("undefined");
		expect(s["setting.openTabById"]).not.toBe("undefined");

		// documented, but replaced by instance assignment
		expect(s["adapter.read"]).toBe("bound hookedAdapterRead");
		expect(s["adapter.readBinary"]).toBe("bound hookedAdapterReadBinary");
		expect(s["adapter.write"]).toBe("bound hookedAdapterWrite");
		expect(s["adapter.process"]).toBe("bound hookedAdapterProcess");
		expect(s["vault.cachedRead"]).toBe("bound hookedVaultCachedRead");

		// documented API the plugin relies on
		for (const k of [
			"fileManager.renameFile",
			"vault.getFolderByPath",
			"vault.getAbstractFileByPath",
			"workspace.getActiveViewOfType",
			"vault.adapter.getResourcePath",
		]) {
			expect(s[k]).not.toBe("undefined");
		}
	});

	it("write paths that the plugin does NOT hook still exist (F29 — documents the gap)", async function () {
		const s = await shape();
		// If any of these disappear/rename, F29's analysis must be revisited.
		expect(s["adapter.writeBinary"]).not.toBe("undefined");
		expect(s["adapter.append"]).not.toBe("undefined");
		console.log(`    adapter.appendBinary present: ${s["adapter.appendBinary"] !== "undefined"} (added in Obsidian 1.12)`);
	});

	it("disabling the plugin restores the original functions; enabling re-installs them", async function () {
		await obsidianPage.disablePlugin(PLUGIN_ID);
		let s = await shape();
		for (const k of ["adapter.read", "adapter.readBinary", "adapter.write", "adapter.process", "vault.cachedRead", "file-recovery.onFileChanged", "file-recovery.forceAdd"]) {
			expect(s[k]).not.toMatch(/^bound hooked/);
			expect(s[k]).not.toBe("undefined");
		}
		// no "Inconsistent plugin unload" dialog
		const modalText = await browser.execute(() => document.querySelector(".modal-container")?.textContent ?? "");
		expect(modalText).not.toContain("Inconsistent plugin unload");

		await obsidianPage.enablePlugin(PLUGIN_ID);
		s = await shape();
		expect(s["adapter.read"]).toBe("bound hookedAdapterRead");
		expect(s["file-recovery.onFileChanged"]).toBe("bound hookedFileRecoveryOnFileChange");
	});

	it("file-recovery keeps exactly one vault 'modify' registration for the plugin's hook after enable/disable cycles", async function () {
		// The plugin re-registers file-recovery's listener by function identity (main.ts:170-182).
		// If Obsidian changes how file-recovery registers, plaintext could reach the recovery store.
		const count = await browser.executeObsidian(({ app }) => {
			const a = app as any;
			const fr = a.internalPlugins.plugins["file-recovery"].instance;
			const refs: any[] = a.vault._?.modify ?? a.vault.events?.modify ?? [];
			// Obsidian stores handlers under `vault._` (Events); tolerate absence by returning -1
			if (!Array.isArray(refs)) return -1;
			return refs.filter((r) => r.fn === fr.onFileChanged || r.callback === fr.onFileChanged).length;
		});
		console.log(`    file-recovery 'modify' registrations pointing at the hook: ${count}`);
		if (count !== -1) expect(count).toBe(1);
	});
});
