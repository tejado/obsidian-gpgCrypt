/**
 * SettingsTab with `settings.backend = "wrapper"` (GnuPG CLI Wrapper): executable probe status line,
 * recipient dropdown (async key listing + confirmation dialog) and the wrapper toggles.
 * `refreshBackendSettings()` runs the async probes from display(), hence the `flush()` calls.
 */
import { describe, expect, test } from "vitest";
import { Modal, Notice } from "obsidian";
import DialogModal from "src/modals/DialogModal";
import { CliPathStatus } from "src/backend/wrapper/BackendWrapper";
import { choose, defaultSettings, flush, mountSettingsTab, optionsOf, type MountOptions } from "./settings-tab-harness";

const KEYS = [
	{ keyID: "AAA", userID: "A <a@x>" },
	{ keyID: "BBB", userID: "B <b@x>" },
];

function mountWrapper(options: MountOptions = {}) {
	return mountSettingsTab({
		...options,
		settings: {
			backend: "wrapper",
			backendWrapper: { ...defaultSettings().backendWrapper, recipient: "BBB" },
			...options.settings,
		},
	});
}

function statusLine(m: ReturnType<typeof mountSettingsTab>): HTMLElement | null {
	const divs = Array.from(m.row("GPG executable").querySelectorAll<HTMLElement>(".setting-item-description div"));
	return divs.find((d) => d.textContent?.startsWith("Status:")) ?? null;
}

describe("SettingsTab wrapper: GPG executable probe", () => {
	test("gpg found: success status, executable applied and saved", async () => {
		const m = mountWrapper();
		await flush();

		expect(m.plugin.gpgWrapper.isGPG).toHaveBeenCalledWith("gpg");
		const status = statusLine(m)!;
		expect(status.textContent).toBe("Status: GPG found.");
		expect(status.classList.contains("mod-success")).toBe(true);
		expect(status.classList.contains("mod-warning")).toBe(false);
		expect(m.plugin.gpgWrapper.setExecutable).toHaveBeenCalledWith("gpg");
		expect(m.plugin.saveSettings).toHaveBeenCalled();
		// the description keeps its explanatory line above the status
		expect(m.row("GPG executable").querySelector(".setting-item-description")?.textContent).toContain("Path to GPG executable.");
	});

	test("ENOENT: warning status, executable NOT applied and nothing saved", async () => {
		const m = mountWrapper({ plugin: (p) => p.gpgWrapper.isGPG.mockResolvedValue(CliPathStatus.ENOENT) });
		await flush();

		const status = statusLine(m)!;
		expect(status.textContent).toBe("Status: File or directory not found.");
		expect(status.classList.contains("mod-warning")).toBe(true);
		expect(status.classList.contains("mod-success")).toBe(false);
		expect(m.plugin.gpgWrapper.setExecutable).not.toHaveBeenCalled();
		expect(m.plugin.saveSettings).not.toHaveBeenCalled();
	});

	test("typing a new executable path re-probes it", async () => {
		const m = mountWrapper();
		await flush();
		m.plugin.gpgWrapper.isGPG.mockClear();
		m.plugin.gpgWrapper.setExecutable.mockClear();

		m.input("GPG executable").value = "/opt/gpg/bin/gpg";
		m.input("GPG executable").dispatchEvent(new Event("input", { bubbles: true }));
		await flush();

		expect(m.plugin.gpgWrapper.isGPG).toHaveBeenCalledWith("/opt/gpg/bin/gpg");
		expect(m.plugin.gpgWrapper.setExecutable).toHaveBeenCalledWith("/opt/gpg/bin/gpg");
		expect(m.settings.backendWrapper.executable).toBe("/opt/gpg/bin/gpg");
	});

	// F21 — checkGpgExecutable only persists a path when the probe says FOUND; an invalid path typed by
	// the user is shown as a warning but never stored, so it silently reverts on the next display().
	test("[F21] an invalid executable path is not persisted (documented behaviour)", async () => {
		const m = mountWrapper();
		await flush();
		m.plugin.gpgWrapper.isGPG.mockResolvedValue(CliPathStatus.NO_GPG_IN_PATH);
		m.plugin.saveSettings.mockClear();

		m.input("GPG executable").value = "/nowhere/notgpg";
		m.input("GPG executable").dispatchEvent(new Event("input", { bubbles: true }));
		await flush();

		expect(statusLine(m)?.textContent).toBe("Status: GPG is not in the specified path.");
		expect(m.settings.backendWrapper.executable).toBe("gpg");
		expect(m.plugin.saveSettings).not.toHaveBeenCalled();
	});
});

describe("SettingsTab wrapper: recipient dropdown", () => {
	test("shows 'Loading keys...' until the keys arrive, then lists them and selects the configured recipient", async () => {
		const m = mountWrapper({ plugin: (p) => p.gpgWrapper.getPublicKeys.mockResolvedValue(KEYS) });
		expect(optionsOf(m.select("Key ID / Recipient"))).toEqual([{ value: "loading", text: "Loading keys..." }]);
		expect(m.select("Key ID / Recipient").disabled).toBe(true);

		await flush();

		const select = m.select("Key ID / Recipient");
		expect(optionsOf(select)).toEqual([
			{ value: "AAA", text: "A <a@x> (AAA)" },
			{ value: "BBB", text: "B <b@x> (BBB)" },
		]);
		expect(select.value).toBe("BBB");
		expect(select.disabled).toBe(false);
		expect(m.row("Key ID / Recipient").classList.contains("mod-warning")).toBe(false);
		expect(Notice.messages()).toEqual([]);
	});

	test("no keys: Notice, disabled 'No keys found' option and mod-warning row", async () => {
		const m = mountWrapper();
		await flush();

		const select = m.select("Key ID / Recipient");
		expect(optionsOf(select)).toEqual([{ value: "nokeys", text: "No keys found" }]);
		expect(select.value).toBe("nokeys");
		expect(select.disabled).toBe(true);
		expect(m.row("Key ID / Recipient").classList.contains("mod-warning")).toBe(true);
		expect(Notice.messages()).toContain("No keys found.");
	});

	test("changing the recipient asks for confirmation; Yes saves the new key", async () => {
		const m = mountWrapper({ plugin: (p) => p.gpgWrapper.getPublicKeys.mockResolvedValue(KEYS) });
		await flush();
		m.plugin.saveSettings.mockClear();

		choose(m.select("Key ID / Recipient"), "AAA");
		await flush();

		expect(Modal.opened__).toHaveLength(1);
		const dialog = Modal.opened__[0];
		expect(dialog).toBeInstanceOf(DialogModal);
		expect(dialog.contentEl.textContent).toContain("Are you sure you want to proceed with this change?");
		expect(m.settings.backendWrapper.recipient).toBe("BBB"); // not yet

		dialog.contentEl.querySelector<HTMLButtonElement>("button.mod-cta")!.click();
		await flush();

		expect(m.settings.backendWrapper.recipient).toBe("AAA");
		expect(m.plugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(m.select("Key ID / Recipient").value).toBe("AAA");
	});

	test("changing the recipient and answering No reverts the dropdown", async () => {
		const m = mountWrapper({ plugin: (p) => p.gpgWrapper.getPublicKeys.mockResolvedValue(KEYS) });
		await flush();
		m.plugin.saveSettings.mockClear();

		choose(m.select("Key ID / Recipient"), "AAA");
		await flush();
		const dialog = Modal.opened__[0];
		Array.from(dialog.contentEl.querySelectorAll("button")).find((b) => b.textContent === "No")!.click();
		await flush();

		expect(m.settings.backendWrapper.recipient).toBe("BBB");
		expect(m.select("Key ID / Recipient").value).toBe("BBB");
		expect(m.plugin.saveSettings).not.toHaveBeenCalled();
	});

	test("dismissing the confirmation dialog (close) reverts the dropdown", async () => {
		const m = mountWrapper({ plugin: (p) => p.gpgWrapper.getPublicKeys.mockResolvedValue(KEYS) });
		await flush();

		choose(m.select("Key ID / Recipient"), "AAA");
		await flush();
		Modal.opened__[0].close();
		await flush();

		expect(m.settings.backendWrapper.recipient).toBe("BBB");
		expect(m.select("Key ID / Recipient").value).toBe("BBB");
	});
});

describe("SettingsTab wrapper: toggles persist", () => {
	test.each([
		["Always trust keys", "trustModelAlways", false],
		["Use compression", "compression", false],
		["Cache decrypted notes", "cache", true],
		["Show decryption dialog", "showDecryptModal", true],
	] as const)("clicking '%s' flips settings.backendWrapper.%s and saves", async (name, key, initial) => {
		const m = mountWrapper();
		await flush();
		m.plugin.saveSettings.mockClear();

		expect(m.settings.backendWrapper[key]).toBe(initial);
		expect(m.toggle(name).classList.contains("is-enabled")).toBe(initial);

		m.toggle(name).click();
		expect(m.settings.backendWrapper[key]).toBe(!initial);
		expect(m.plugin.saveSettings).toHaveBeenCalledTimes(1);

		m.toggle(name).click();
		expect(m.settings.backendWrapper[key]).toBe(initial);
		expect(m.plugin.saveSettings).toHaveBeenCalledTimes(2);
	});

	test("wrapper rows are visible, native rows hidden", async () => {
		const m = mountWrapper();
		await flush();
		for (const name of ["GPG executable", "Always trust keys", "Use compression", "Cache decrypted notes", "Key ID / Recipient", "Show decryption dialog"]) {
			expect(m.row(name).style.display, name).not.toBe("none");
		}
		for (const name of ["Public key", "Private key", "Ask passphrase on startup", "Remember passphrase", "Restart passphrase timeout on save"]) {
			expect(m.row(name).style.display, name).toBe("none");
		}
	});
});
