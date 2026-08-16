/**
 * SettingsTab (src/settings/SettingsTab.ts) rendered with the native (OpenPGP.js) backend against a fake
 * plugin object. Interaction happens through DOM events on the rendered rows; assertions are on the
 * settings object, the fake plugin spies and the DOM. Wrapper-backend specifics: SettingsTab.wrapper.test.ts.
 */
import { describe, expect, test } from "vitest";
import { Modal, Notice, Platform } from "obsidian";
import WelcomeModal from "src/modals/WelcomeModal";
import { choose, defaultSettings, flush, mountSettingsTab, optionsOf, typeInto } from "./settings-tab-harness";

const NATIVE_ROWS = ["Public key", "Private key", "Ask passphrase on startup", "Remember passphrase", "Restart passphrase timeout on save"];
const WRAPPER_ROWS = ["GPG executable", "Always trust keys", "Use compression", "Cache decrypted notes", "Key ID / Recipient", "Show decryption dialog"];

describe("SettingsTab layout", () => {
	test("renders every setting row in order", () => {
		const m = mountSettingsTab();
		expect(m.names()).toEqual([
			"Encrypt all notes",
			"Encrypt Folders",
			"Use .gpg file extension",
			"File recovery format for encrypted notes",
			"Compatibility mode",
			"Encryption Backend",
			"Encryption backend",
			"Public key",
			"Private key",
			"Ask passphrase on startup",
			"Remember passphrase",
			"Restart passphrase timeout on save",
			"GPG executable",
			"Always trust keys",
			"Use compression",
			"Cache decrypted notes",
			"Key ID / Recipient",
			"Show decryption dialog",
			"About",
			"Show welcome dialog",
			"Learn more",
		]);
	});

	test("'Encryption Backend' and 'About' are headings", () => {
		const m = mountSettingsTab();
		expect(m.row("Encryption Backend").classList.contains("setting-item-heading")).toBe(true);
		expect(m.row("About").classList.contains("setting-item-heading")).toBe(true);
		expect(m.row("Encrypt all notes").classList.contains("setting-item-heading")).toBe(false);
	});

	test("display() twice does not duplicate rows", () => {
		const m = mountSettingsTab();
		const before = m.names();
		m.tab.display();
		expect(m.names()).toEqual(before);
	});

	test("compatibility mode shows the plaintext-metadata warning", () => {
		const m = mountSettingsTab();
		const warning = m.row("Compatibility mode").querySelector(".setting-item-description span.mod-warning");
		expect(warning?.textContent).toBe("Warning: this exposes plaintext headings and file structure on disk.");
	});

	test("'Learn more' links to the GitHub repository in a new tab", () => {
		const m = mountSettingsTab();
		const anchor = m.row("Learn more").querySelector<HTMLAnchorElement>("a")!;
		expect(anchor.getAttribute("href")).toBe("https://github.com/tejado/obsidian-gpgCrypt");
		expect(anchor.textContent).toBe("https://github.com/tejado/obsidian-gpgCrypt");
		expect(anchor.getAttribute("target")).toBe("_blank");
	});

	test("initial toggle/dropdown states mirror the settings", () => {
		const m = mountSettingsTab({
			settings: { encryptAll: true, renameToGpg: false, compatibilityMode: true, fileRecovery: "skip", passphraseTimeout: 42 },
		});
		expect(m.toggle("Encrypt all notes").classList.contains("is-enabled")).toBe(true);
		expect(m.toggle("Use .gpg file extension").classList.contains("is-enabled")).toBe(false);
		expect(m.toggle("Compatibility mode").classList.contains("is-enabled")).toBe(true);
		expect(m.select("File recovery format for encrypted notes").value).toBe("skip");
		expect(m.input("Remember passphrase").value).toBe("42");
		expect(m.input("Public key").value).toBe("public.asc");
		expect(m.input("Private key").value).toBe("private.asc");
	});
});

describe("SettingsTab toggles persist", () => {
	test.each([
		["Encrypt all notes", "encryptAll"],
		["Use .gpg file extension", "renameToGpg"],
		["Compatibility mode", "compatibilityMode"],
		["Ask passphrase on startup", "askPassphraseOnStartup"],
		["Restart passphrase timeout on save", "resetPassphraseTimeoutOnWrite"],
	] as const)("clicking the '%s' toggle flips settings.%s and saves", (name, key) => {
		const m = mountSettingsTab();
		expect(m.settings[key]).toBe(false);

		m.toggle(name).click();
		expect(m.settings[key]).toBe(true);
		expect(m.plugin.saveSettings).toHaveBeenCalledTimes(1);

		m.toggle(name).click();
		expect(m.settings[key]).toBe(false);
		expect(m.plugin.saveSettings).toHaveBeenCalledTimes(2);
	});
});

describe("SettingsTab file recovery", () => {
	test("dropdown offers encrypted / plaintext / skip and persists the choice", () => {
		const m = mountSettingsTab();
		const select = m.select("File recovery format for encrypted notes");

		expect(optionsOf(select).map((o) => o.value)).toEqual(["encrypted", "plaintext", "skip"]);
		expect(optionsOf(select).map((o) => o.text)).toEqual([
			"Encrypted (manual decrypt in case of recovery)",
			"Plaintext",
			"Disable file recovery for encrypted notes",
		]);
		expect(select.value).toBe("encrypted");

		choose(select, "plaintext");
		expect(m.settings.fileRecovery).toBe("plaintext");
		expect(m.plugin.saveSettings).toHaveBeenCalledTimes(1);
	});
});

describe("SettingsTab backend switch", () => {
	test("dropdown offers native and wrapper; native is selected by default", () => {
		const m = mountSettingsTab();
		const select = m.select("Encryption backend");
		expect(optionsOf(select)).toEqual([
			{ value: "native", text: "OpenPGP.js" },
			{ value: "wrapper", text: "GnuPG CLI Wrapper" },
		]);
		expect(select.value).toBe("native");
	});

	test("native backend: native rows are shown, wrapper rows hidden; wrapper backend not probed", () => {
		const m = mountSettingsTab();
		for (const name of NATIVE_ROWS) expect(m.row(name).style.display, name).not.toBe("none");
		for (const name of WRAPPER_ROWS) expect(m.row(name).style.display, name).toBe("none");
		expect(m.plugin.gpgWrapper.isGPG).not.toHaveBeenCalled();
		expect(m.plugin.gpgWrapper.getPublicKeys).not.toHaveBeenCalled();
	});

	test("switching to wrapper flips visibility, probes gpg, loads keys and saves", async () => {
		const m = mountSettingsTab({ settings: { backendWrapper: { ...defaultSettings().backendWrapper, executable: "/usr/bin/gpg" } } });

		choose(m.select("Encryption backend"), "wrapper");
		await flush();

		expect(m.settings.backend).toBe("wrapper");
		for (const name of NATIVE_ROWS) expect(m.row(name).style.display, name).toBe("none");
		for (const name of WRAPPER_ROWS) expect(m.row(name).style.display, name).not.toBe("none");
		expect(m.plugin.gpgWrapper.isGPG).toHaveBeenCalledWith("/usr/bin/gpg");
		expect(m.plugin.gpgWrapper.getPublicKeys).toHaveBeenCalledTimes(1);
		expect(m.plugin.saveSettings).toHaveBeenCalled();
	});

	test("switching back to native restores the native rows", async () => {
		const m = mountSettingsTab({ settings: { backend: "wrapper" } });
		await flush();
		for (const name of NATIVE_ROWS) expect(m.row(name).style.display, name).toBe("none");

		choose(m.select("Encryption backend"), "native");
		await flush();

		expect(m.settings.backend).toBe("native");
		for (const name of NATIVE_ROWS) expect(m.row(name).style.display, name).not.toBe("none");
		for (const name of WRAPPER_ROWS) expect(m.row(name).style.display, name).toBe("none");
	});

	// F21: refreshBackendSettings() mutates `backendWrapper.cache = false` whenever
	// the native branch is rendered — including on plain display() — without saving. In-memory settings then
	// differ from data.json (the default is cache=true) until some other setting change happens to persist
	// them. Via the dropdown the flag is only persisted incidentally by the backend-change save.
	// Documented as current behaviour.
	test("[F21] switching to native silently sets backendWrapper.cache=false without saving", async () => {
		// (a) plain display() with the native backend: the wrapper flag flips, nothing is saved
		const m = mountSettingsTab({ settings: { backend: "native", backendWrapper: { ...defaultSettings().backendWrapper, cache: true } } });
		await flush();
		expect(m.settings.backendWrapper.cache).toBe(false);
		expect(m.plugin.saveSettings).not.toHaveBeenCalled();

		// (b) via the dropdown: the wrapper branch leaves the flag alone, the native branch resets it again;
		//     the only save is the one for the backend change itself (no dedicated save for the flag)
		m.settings.backendWrapper.cache = true;
		choose(m.select("Encryption backend"), "wrapper");
		await flush();
		expect(m.settings.backendWrapper.cache).toBe(true);
		m.plugin.saveSettings.mockClear();

		choose(m.select("Encryption backend"), "native");
		await flush();
		expect(m.settings.backendWrapper.cache).toBe(false);
		expect(m.plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	test("mobile: the backend dropdown only offers the disabled native option", () => {
		Platform.isMobile = true;
		const m = mountSettingsTab();

		const select = m.select("Encryption backend");
		expect(optionsOf(select)).toEqual([{ value: "native", text: "OpenPGP.js" }]);
		expect(select.disabled).toBe(true);
		expect(m.row("Encryption backend").querySelector(".setting-item-description")?.textContent).toContain("Only native OpenPGP.js is supported on mobile devices.");
	});
});

describe("SettingsTab native backend rows", () => {
	test("'Remember passphrase': invalid input reverts to the previous value without saving", () => {
		const m = mountSettingsTab();
		const input = m.input("Remember passphrase");
		expect(input.value).toBe("300");

		typeInto(input, "abc");

		expect(input.value).toBe("300");
		expect(m.settings.passphraseTimeout).toBe(300);
		expect(m.plugin.saveSettings).not.toHaveBeenCalled();
		expect(m.plugin.cache.setTimeout).not.toHaveBeenCalled();
	});

	test("'Remember passphrase': values below 10 are clamped to 10", () => {
		const m = mountSettingsTab();
		typeInto(m.input("Remember passphrase"), "5");

		expect(m.settings.passphraseTimeout).toBe(10);
		expect(m.plugin.cache.setTimeout).toHaveBeenCalledWith(10);
		expect(m.plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	test("'Remember passphrase': a valid value is applied and saved", () => {
		const m = mountSettingsTab();
		typeInto(m.input("Remember passphrase"), "120");

		expect(m.settings.passphraseTimeout).toBe(120);
		expect(m.plugin.cache.setTimeout).toHaveBeenCalledWith(120);
		expect(m.plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	test("'Public key' path is normalized, saved and the key pair reloaded", async () => {
		const m = mountSettingsTab();
		typeInto(m.input("Public key"), "keys//pub.asc");
		await flush();

		expect(m.settings.backendNative.publicKeyPath).toBe("keys/pub.asc");
		expect(m.plugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(m.plugin.loadKeypair).toHaveBeenCalledTimes(1);
	});

	test("'Private key' path is normalized, saved and the key pair reloaded", async () => {
		const m = mountSettingsTab();
		typeInto(m.input("Private key"), "\\keys\\priv.asc");
		await flush();

		expect(m.settings.backendNative.privateKeyPath).toBe("keys/priv.asc");
		expect(m.plugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(m.plugin.loadKeypair).toHaveBeenCalledTimes(1);
	});

	test("'Generate new key pair...' calls plugin.generateKeypair and shows the new public key path", async () => {
		const m = mountSettingsTab({
			plugin: (p) => {
				p.generateKeypair.mockImplementation(async () => {
					m.settings.backendNative.publicKeyPath = "p.asc";
					m.settings.backendNative.privateKeyPath = "s.asc";
					return true;
				});
			},
		});
		const button = m.button("Public key", "Generate new key pair...");
		expect(button.classList.contains("mod-cta")).toBe(true);

		button.click();
		await flush();

		expect(m.plugin.generateKeypair).toHaveBeenCalledTimes(1);
		expect(m.input("Public key").value).toBe("p.asc");
	});

	test("'Generate new key pair...' leaves the fields alone when generation fails", async () => {
		const m = mountSettingsTab({ plugin: (p) => p.generateKeypair.mockResolvedValue(false) });

		m.button("Public key", "Generate new key pair...").click();
		await flush();

		expect(m.plugin.generateKeypair).toHaveBeenCalledTimes(1);
		expect(m.input("Public key").value).toBe("public.asc");
		expect(m.input("Private key").value).toBe("private.asc");
	});

	// F21 — SettingsTab.ts:204 assigns the PUBLIC key path to the private key field after generation.
	test.fails("[F21] after key generation the private key field shows the PRIVATE key path", async () => {
		const m = mountSettingsTab({
			plugin: (p) => {
				p.generateKeypair.mockImplementation(async () => {
					m.settings.backendNative.publicKeyPath = "p.asc";
					m.settings.backendNative.privateKeyPath = "s.asc";
					return true;
				});
			},
		});

		m.button("Public key", "Generate new key pair...").click();
		await flush();

		expect(m.input("Private key").value).toBe("s.asc");
	});
});

describe("SettingsTab about section", () => {
	test("'Show welcome dialog' opens the WelcomeModal (non-first-load variant)", async () => {
		const m = mountSettingsTab();
		const button = m.button("Show welcome dialog");
		expect(button.textContent).toBe("Open welcome dialog...");

		button.click();
		await flush();

		expect(Modal.opened__).toHaveLength(1);
		const modal = Modal.opened__[0];
		expect(modal).toBeInstanceOf(WelcomeModal);
		expect(modal.contentEl.textContent).toContain("Welcome to gpgCrypt");
		const buttons = Array.from(modal.contentEl.querySelectorAll("button")).map((b) => b.textContent);
		expect(buttons).toEqual(["Generate new key pair...", "Close"]);

		// closing it does not trigger key generation
		modal.close();
		await flush();
		expect(m.plugin.generateKeypair).not.toHaveBeenCalled();
	});

	test("choosing 'Generate new key pair...' in the welcome dialog runs the generation", async () => {
		const m = mountSettingsTab({
			plugin: (p) => {
				p.generateKeypair.mockImplementation(async () => {
					m.settings.backendNative.publicKeyPath = "gen.asc";
					m.settings.backendNative.privateKeyPath = "gen-private.asc";
					return true;
				});
			},
		});
		m.button("Show welcome dialog").click();
		await flush();

		const modal = Modal.opened__[0];
		Array.from(modal.contentEl.querySelectorAll("button")).find((b) => b.textContent === "Generate new key pair...")!.click();
		await flush();

		expect(m.plugin.generateKeypair).toHaveBeenCalledTimes(1);
		expect(m.input("Public key").value).toBe("gen.asc");
	});
});

describe("SettingsTab encrypt folders", () => {
	function folderList(m: ReturnType<typeof mountSettingsTab>) {
		const outer = m.tab.containerEl.querySelector<HTMLElement>(".setting-list-item")!;
		const list = outer.querySelector<HTMLElement>(".list-input")!;
		return {
			outer,
			list,
			inputs: () => Array.from(list.querySelectorAll<HTMLInputElement>("input")),
			errors: () => Array.from(list.querySelectorAll<HTMLElement>(".error-text")).map((e) => e.textContent ?? ""),
			removeButtons: () => Array.from(list.querySelectorAll<HTMLButtonElement>("button")).filter((b) => b.textContent === "Remove"),
		};
	}

	test("existing folders are rendered as rows", () => {
		const m = mountSettingsTab({ settings: { foldersToEncrypt: ["secret", "other"] } });
		const fl = folderList(m);
		expect(fl.inputs().map((i) => i.value)).toEqual(["secret", "other"]);
		expect(fl.removeButtons()).toHaveLength(2);
	});

	test("'Add Folder' adds an empty row and an empty entry", () => {
		const m = mountSettingsTab();
		const fl = folderList(m);
		expect(fl.inputs()).toHaveLength(0);

		m.button("Encrypt Folders", "Add Folder").click();

		expect(fl.inputs()).toHaveLength(1);
		expect(fl.inputs()[0].value).toBe("");
		expect(m.settings.foldersToEncrypt).toEqual([""]);
		expect(m.plugin.saveSettings).not.toHaveBeenCalled();
	});

	test("typing an existing folder saves it; a missing folder shows the validation error", () => {
		const m = mountSettingsTab({ folders: ["secret"] });
		const fl = folderList(m);
		m.button("Encrypt Folders", "Add Folder").click();
		const input = fl.inputs()[0];

		typeInto(input, "secret");
		expect(m.settings.foldersToEncrypt).toEqual(["secret"]);
		expect(m.plugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(input.classList.contains("error")).toBe(false);
		expect(fl.errors()).toEqual([""]);

		typeInto(input, "missing");
		expect(fl.errors()).toEqual(["This Folder doesn't seem to exist in your Obsidian Vault"]);
		expect(input.classList.contains("error")).toBe(true);
		expect(m.settings.foldersToEncrypt).toEqual(["secret"]);
		expect(m.plugin.saveSettings).toHaveBeenCalledTimes(1);

		typeInto(input, "secret");
		expect(fl.errors()).toEqual([""]);
		expect(input.classList.contains("error")).toBe(false);
		expect(m.plugin.saveSettings).toHaveBeenCalledTimes(2);
	});

	test("'Remove' deletes the entry, the input and the button and saves", () => {
		const m = mountSettingsTab({ settings: { foldersToEncrypt: ["secret"] } });
		const fl = folderList(m);
		expect(fl.inputs()).toHaveLength(1);

		fl.removeButtons()[0].click();

		expect(m.settings.foldersToEncrypt).toEqual([]);
		expect(m.plugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(fl.inputs()).toHaveLength(0);
		expect(fl.removeButtons()).toHaveLength(0);
	});

	test("no Notice is produced while editing folders", () => {
		const m = mountSettingsTab();
		m.button("Encrypt Folders", "Add Folder").click();
		typeInto(folderList(m).inputs()[0], "missing");
		expect(Notice.messages()).toEqual([]);
	});
});
