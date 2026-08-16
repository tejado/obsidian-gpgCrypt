/**
 * Status bar indicator (src/main.ts statusBarRefresh): the real plugin booted via the harness; the lock
 * icon must appear for the ACTIVE encrypted note only and disappear for plaintext notes / on unload.
 */
import { afterEach, describe, expect, test } from "vitest";
import { createPluginHarness, type Harness } from "../helpers/plugin-harness";
import { CIPHERTEXT_NOPASS } from "../helpers/fixtures";

let h: Harness | undefined;
afterEach(async () => {
	await h?.unload();
	h = undefined;
});

async function boot() {
	h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS, "Plain.md": "x" } });
	const item = h.plugin.statusBarItems__[0];
	const encrypted = h.app.vault.getFileByPath("Encrypted.md")!;
	const plain = h.app.vault.getFileByPath("Plain.md")!;
	return { h, item, encrypted, plain };
}

describe("status bar file-state indicator", () => {
	test("the plugin registers exactly one status bar item inside .status-bar", async () => {
		const { item } = await boot();
		expect(h!.plugin.statusBarItems__).toHaveLength(1);
		expect(item.classList.contains("status-bar-item")).toBe(true);
		expect(item.closest(".status-bar")).not.toBeNull();
		expect(document.body.contains(item)).toBe(true);
	});

	test("opening an encrypted note shows the lock icon with tooltip", async () => {
		const { item, encrypted } = await boot();

		// Obsidian reads the note (through the hooked adapter → decrypt + status tracking) …
		expect(await h!.app.vault.read(encrypted)).toBe("Hello secret world\n");
		// … and makes it the active file
		h!.app.workspace.setActiveFile__(encrypted);

		expect(item.style.display).not.toBe("none");
		expect(item.getAttribute("aria-label")).toBe("Encrypted with key pair");
		expect(item.getAttribute("data-tooltip-position")).toBe("top");
		expect(item.querySelector("svg.lucide-lock")).not.toBeNull();
	});

	test("switching to a plaintext note hides the indicator", async () => {
		const { item, encrypted, plain } = await boot();
		await h!.app.vault.read(encrypted);
		h!.app.workspace.setActiveFile__(encrypted);
		expect(item.style.display).not.toBe("none");

		await h!.app.vault.read(plain);
		h!.app.workspace.setActiveFile__(plain);

		expect(item.style.display).toBe("none");
	});

	test("switching back to the encrypted note shows it again", async () => {
		const { item, encrypted, plain } = await boot();
		await h!.app.vault.read(encrypted);
		await h!.app.vault.read(plain);
		h!.app.workspace.setActiveFile__(plain);
		expect(item.style.display).toBe("none");

		h!.app.workspace.setActiveFile__(encrypted);
		expect(item.style.display).not.toBe("none");
		expect(item.querySelector("svg.lucide-lock")).not.toBeNull();
	});

	test("a modify event for a NON-active file leaves the indicator untouched", async () => {
		const { item, encrypted, plain } = await boot();
		await h!.app.vault.read(encrypted);
		await h!.app.vault.read(plain);
		h!.app.workspace.setActiveFile__(encrypted);
		expect(item.style.display).not.toBe("none");

		await h!.app.vault.modify(plain, "y");

		expect(item.style.display).not.toBe("none");
		expect(item.querySelector("svg.lucide-lock")).not.toBeNull();

		// and the other way round: active plaintext note stays hidden when the encrypted note changes
		h!.app.workspace.setActiveFile__(plain);
		expect(item.style.display).toBe("none");
		h!.app.vault.trigger("modify", encrypted);
		expect(item.style.display).toBe("none");
	});

	test("unloading the plugin removes the status bar item from the DOM", async () => {
		const { item, encrypted } = await boot();
		await h!.app.vault.read(encrypted);
		h!.app.workspace.setActiveFile__(encrypted);
		expect(document.body.contains(item)).toBe(true);

		await h!.unload();
		h = undefined;

		expect(document.body.contains(item)).toBe(false);
		expect(item.isConnected).toBe(false);
	});
});
