/**
 * Plugin lifecycle: hook installation in `onload` (main.ts:64-301), restoration in `onunload` (:303-348),
 * the first-run / startup-passphrase flows of the layout-ready callback (:82-127), `loadSettings`
 * (:976-1024), `loadKeypair` (:1026-1031) and `generateKeypair` (:939-974).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { Modal, Notice, Platform } from "obsidian";
import { createPluginHarness, flush, waitFor, type Harness } from "../helpers/plugin-harness";
import DialogModal from "src/modals/DialogModal";
import GenerateKeypairModal from "src/modals/GenerateKeypairModal";
import PassphraseModal from "src/modals/PassphraseModal";
import WelcomeModal from "src/modals/WelcomeModal";

let h: Harness | undefined;
afterEach(async () => {
	await h?.unload();
	h = undefined;
	vi.unstubAllGlobals();
});

/** newest still-open modal of the given class */
function openModal<T extends Modal>(ctor: new (...args: any[]) => T): T | undefined {
	return [...Modal.opened__].reverse().find((m): m is T => m instanceof ctor && m.isOpen__);
}
async function waitForModal<T extends Modal>(ctor: new (...args: any[]) => T): Promise<T> {
	await waitFor(() => openModal(ctor) !== undefined);
	return openModal(ctor)!;
}
function clickButton(modal: Modal, text: string): void {
	const button = Array.from(modal.contentEl.querySelectorAll("button")).find((b) => b.textContent === text);
	if (!button) throw new Error(`no button "${text}" in modal`);
	button.click();
}
function submitPassphrase(modal: PassphraseModal, passphrase: string): void {
	(modal.contentEl.querySelector("input[type=password]") as HTMLInputElement).value = passphrase;
	(modal.contentEl.querySelector("button.mod-cta") as HTMLButtonElement).click();
}
/** serve `fetch(app://local/<path>)` (the external-file fallback of getFileContentExternal) from the fake disk */
function stubFetchFromDisk(): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn(async (url: string) => ({
		text: async () => h?.disk(String(url).replace("app://local/", "")) ?? "",
	}));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

describe("onload installs the hooks", () => {
	test("adapter read/readBinary/write/process, vault.cachedRead and the file-recovery functions are replaced by bound hooks", async () => {
		h = await createPluginHarness();
		const adapter = h.app.vault.adapter;
		const recovery = h.app.internalPlugins.plugins["file-recovery"]!.instance;

		expect(adapter.read.name).toBe("bound hookedAdapterRead");
		expect(adapter.readBinary.name).toBe("bound hookedAdapterReadBinary");
		expect(adapter.write.name).toBe("bound hookedAdapterWrite");
		expect(adapter.process.name).toBe("bound hookedAdapterProcess");
		expect(h.app.vault.cachedRead.name).toBe("bound hookedVaultCachedRead");
		expect(recovery.onFileChanged.name).toBe("bound hookedFileRecoveryOnFileChange");
		expect(recovery.forceAdd.name).toBe("bound hookedFileRecoveryForceAdd");
	});

	test("the file-recovery listeners on vault 'modify' and workspace 'file-open' point to the hook, not to the original", async () => {
		h = await createPluginHarness({ load: false });
		const original = h.app.fileRecovery!.onFileChanged;
		expect(h.app.vault.listeners__("modify")).toContain(original);
		await h.plugin.onload();
		const hooked = h.app.internalPlugins.plugins["file-recovery"]!.instance.onFileChanged;
		expect(hooked).not.toBe(original);

		for (const listeners of [h.app.vault.listeners__("modify"), h.app.workspace.listeners__("file-open")]) {
			expect(listeners).toContain(hooked);
			expect(listeners).not.toContain(original);
		}
	});

	test("registers the commands, the .gpg extension, a settings tab and a status bar item", async () => {
		h = await createPluginHarness();
		expect(Object.keys(h.plugin.commands__).sort()).toEqual(["gpg-crypt:gpg-decrypt-permanently", "gpg-crypt:gpg-encrypt-permanently"]);
		expect(h.plugin.extensions__).toEqual([{ extensions: ["gpg"], viewType: "markdown" }]);
		expect(h.plugin.settingTabs__).toHaveLength(1);
		expect(h.plugin.statusBarItems__).toHaveLength(1);
		expect(h.plugin.statusBarItems__[0].isConnected).toBe(true);
	});
});

describe("onunload restores the originals", () => {
	test("every patched function is restored, the file-recovery listener is re-registered and the status bar item is removed", async () => {
		h = await createPluginHarness({ load: false });
		const adapter = h.app.vault.adapter;
		const recovery = h.app.internalPlugins.plugins["file-recovery"]!.instance;
		const originals = {
			read: adapter.read,
			readBinary: adapter.readBinary,
			write: adapter.write,
			process: adapter.process,
			cachedRead: h.app.vault.cachedRead,
			onFileChanged: recovery.onFileChanged,
			forceAdd: recovery.forceAdd,
		};

		await h.plugin.onload();
		await h.app.workspace.setLayoutReady__();
		expect(adapter.read).not.toBe(originals.read);
		expect(h.app.vault.cachedRead).not.toBe(originals.cachedRead);
		const hooked = { onFileChanged: recovery.onFileChanged, read: adapter.read };
		const statusBarItem = h.plugin.statusBarItems__[0];
		expect(statusBarItem.isConnected).toBe(true);

		const loaded = h;
		h = undefined; // unloaded below — a second onunload would wait for the "inconsistent unload" dialog forever
		await loaded.unload();

		expect(adapter.read).toBe(originals.read);
		expect(adapter.readBinary).toBe(originals.readBinary);
		expect(adapter.write).toBe(originals.write);
		expect(adapter.process).toBe(originals.process);
		expect(loaded.app.vault.cachedRead).toBe(originals.cachedRead);
		expect(recovery.onFileChanged).toBe(originals.onFileChanged);
		expect(recovery.forceAdd).toBe(originals.forceAdd);

		for (const listeners of [loaded.app.vault.listeners__("modify"), loaded.app.workspace.listeners__("file-open")]) {
			expect(listeners).toContain(originals.onFileChanged);
			expect(listeners).not.toContain(hooked.onFileChanged);
		}
		expect(statusBarItem.isConnected).toBe(false);

		// the vault works again without the plugin: reads/writes are raw
		loaded.app.vault.seed__({ "raw.md": "raw\n" });
		expect(await loaded.app.vault.read(loaded.app.vault.getFileByPath("raw.md")!)).toBe("raw\n");
		expect(adapter.read).not.toBe(hooked.read);
	});

	// F02: onunload is async and awaits a DialogModal when a third-party hook is
	// detected; the restore runs only after the user clicks, and then overwrites the third-party function
	// with gpgCrypt's saved original. Documents the current behaviour.
	test("[F02] third-party override of adapter.write: 'Inconsistent plugin unload' dialog, restore only after dismissal, third-party hook clobbered", async () => {
		h = await createPluginHarness();
		const adapter = h.app.vault.adapter;
		const hookedRead = adapter.read;
		const thirdParty = vi.fn(async () => {});
		adapter.write = thirdParty;

		const loaded = h;
		h = undefined;
		const unloading = loaded.plugin.onunload();
		await flush();

		const dialog = Modal.opened__.find((m) => m instanceof DialogModal) as DialogModal | undefined;
		expect(dialog).toBeDefined();
		expect(dialog!.isOpen__).toBe(true);
		expect(dialog!.contentEl.textContent).toContain("Inconsistent plugin unload");
		// current behaviour: nothing is restored while the dialog is pending
		expect(adapter.read).toBe(hookedRead);
		expect(adapter.write).toBe(thirdParty);

		clickButton(dialog!, "Ok");
		await unloading;

		expect(adapter.read).not.toBe(hookedRead);
		expect(adapter.read.name).not.toBe("bound hookedAdapterRead");
		// the third-party hook is discarded in favour of the plugin's saved original
		expect(adapter.write).not.toBe(thirdParty);
		expect(adapter.write.name).not.toBe("bound hookedAdapterWrite");
	});

	// F03 `app.internalPlugins.plugins["file-recovery"].instance` is dereferenced
	// unconditionally (main.ts:143) → TypeError after the adapter originals were captured but before the hooks
	// were installed. (Not assigned to `h`: onunload of the half-loaded plugin would also throw / hang.)
	test.fails("[F03] onload does not throw when the file-recovery core plugin is disabled", async () => {
		const local = await createPluginHarness({ withoutFileRecovery: true, load: false });
		expect(local.app.internalPlugins.plugins["file-recovery"]).toBeUndefined();

		await expect(local.plugin.onload()).resolves.not.toThrow();
		expect(local.app.vault.adapter.read.name).toBe("bound hookedAdapterRead");
		expect(local.app.vault.adapter.write.name).toBe("bound hookedAdapterWrite");
	});
});

describe("first run (firstLoad=true)", () => {
	async function firstRun(): Promise<{ welcome: WelcomeModal; ready: Promise<void> }> {
		h = await createPluginHarness({ settings: { firstLoad: true }, layoutReady: false });
		const ready = h.app.workspace.setLayoutReady__(); // blocked until the WelcomeModal is closed
		const welcome = await waitForModal(WelcomeModal);
		return { welcome, ready };
	}

	test("shows the WelcomeModal and persists firstLoad=false; 'Open settings…' opens the plugin settings tab", async () => {
		const { welcome, ready } = await firstRun();
		expect(h!.savedData().firstLoad).toBe(false);
		expect(h!.settings().firstLoad).toBe(false);

		clickButton(welcome, "Open settings to use existing key pair...");
		await ready;

		expect(welcome.isOpen__).toBe(false);
		expect(h!.app.setting.open).toHaveBeenCalledWith("gpg-crypt");
		expect(h!.app.setting.openTabById).toHaveBeenCalledWith("gpg-crypt");
	});

	test("'Generate new key pair…' opens the GenerateKeypairModal (cancelled here)", async () => {
		const { welcome, ready } = await firstRun();
		clickButton(welcome, "Generate new key pair...");
		await ready;

		const generate = await waitForModal(GenerateKeypairModal);
		clickButton(generate, "Cancel");
		await flush();
		expect(generate.isOpen__).toBe(false);
		expect(Notice.messages().some((m) => m.includes("aborted"))).toBe(true);
		expect(h!.app.setting.open).not.toHaveBeenCalled();
	});

	test("'Skip configuration' just closes the modal", async () => {
		const { welcome, ready } = await firstRun();
		clickButton(welcome, "Skip configuration");
		await ready;

		expect(welcome.isOpen__).toBe(false);
		expect(Modal.opened__).toEqual([welcome]);
		expect(h!.app.setting.open).not.toHaveBeenCalled();
	});
});

describe("askPassphraseOnStartup (keys: pw)", () => {
	async function startup(): Promise<{ modal: PassphraseModal; ready: Promise<void> }> {
		h = await createPluginHarness({ keys: "pw", settings: { askPassphraseOnStartup: true }, layoutReady: false });
		const ready = h.app.workspace.setLayoutReady__();
		const modal = await waitForModal(PassphraseModal);
		return { modal, ready };
	}

	test("wrong passphrase → Notice + re-prompt; correct passphrase → unlocked Notice and cached passphrase", async () => {
		const { modal, ready } = await startup();
		submitPassphrase(modal, "wrong");

		await waitFor(() => Notice.messages().some((m) => m.includes("Incorrect key passphrase")));
		const second = await waitForModal(PassphraseModal);
		expect(second).not.toBe(modal);

		submitPassphrase(second, "test");
		await ready;

		expect(Notice.messages().some((m) => m.startsWith("Private key successfully unlocked"))).toBe(true);
		expect(h!.plugin.cache.hasPassphrase()).toBe(true);
	});

	test("Cancel stops prompting without a crash", async () => {
		const { modal, ready } = await startup();
		clickButton(modal, "Cancel");
		await ready;

		expect(openModal(PassphraseModal)).toBeUndefined();
		expect(Modal.opened__.filter((m) => m instanceof PassphraseModal)).toHaveLength(1);
		expect(Notice.messages().some((m) => m.includes("No passphrase"))).toBe(true);
		expect(h!.plugin.cache.hasPassphrase()).toBe(false);
	});

	test("no prompt when the option is off, when the key has no passphrase, or when a passphrase is already cached", async () => {
		h = await createPluginHarness({ keys: "pw" });
		expect(Modal.opened__).toHaveLength(0);
		await h.unload();

		h = await createPluginHarness({ keys: "nopass", settings: { askPassphraseOnStartup: true } });
		expect(Modal.opened__).toHaveLength(0);
		await h.unload();

		h = await createPluginHarness({ keys: "pw", settings: { askPassphraseOnStartup: true }, load: false });
		await h.plugin.onload();
		h.plugin.cache.setPassphrase("test");
		await h.app.workspace.setLayoutReady__();
		expect(Modal.opened__).toHaveLength(0);
	});
});

describe("loadSettings (main.ts:976-1024)", () => {
	async function bootWithData(data: unknown): Promise<Harness> {
		const harness = await createPluginHarness({ load: false });
		harness.plugin.__data = data;
		await harness.plugin.onload();
		return harness;
	}

	test("no data.json → defaults", async () => {
		h = await bootWithData(null);
		expect(h.settings()).toEqual({
			firstLoad: true,
			encryptAll: false,
			renameToGpg: false,
			foldersToEncrypt: [],
			fileRecovery: "encrypted",
			compatibilityMode: false,
			backend: "native",
			backendNative: { publicKeyPath: "public.asc", privateKeyPath: "private.asc" },
			backendWrapper: { executable: "gpg", recipient: "", trustModelAlways: false, compression: false, cache: true, showDecryptModal: true },
			askPassphraseOnStartup: false,
			passphraseTimeout: 300,
			resetPassphraseTimeoutOnWrite: false,
		});
	});

	test("partial data.json is merged over the defaults", async () => {
		h = await bootWithData({ firstLoad: false, encryptAll: true, foldersToEncrypt: ["secret"], passphraseTimeout: 60 });
		expect(h.settings()).toMatchObject({
			firstLoad: false,
			encryptAll: true,
			foldersToEncrypt: ["secret"],
			passphraseTimeout: 60,
			renameToGpg: false,
			backend: "native",
			fileRecovery: "encrypted",
		});
	});

	test("passphraseTimeout below 10 s is clamped to 10 s", async () => {
		h = await bootWithData({ firstLoad: false, passphraseTimeout: 5 });
		expect(h.settings().passphraseTimeout).toBe(10);
	});

	test("Platform.isMobile forces the native backend even if data.json says wrapper", async () => {
		Platform.isMobile = true;
		h = await bootWithData({ firstLoad: false, backend: "wrapper" });
		expect(h.settings().backend).toBe("native");
	});

	test("the gpg executable of the wrapper backend is applied to the BackendWrapper", async () => {
		h = await bootWithData({
			firstLoad: false,
			backendWrapper: { executable: "/opt/gnupg/bin/gpg2", recipient: "", trustModelAlways: false, compression: false, cache: true, showDecryptModal: true },
		});
		expect(h.plugin.gpgWrapper.getExecutable()).toBe("/opt/gnupg/bin/gpg2");
	});

	// F15: `Object.assign({}, DEFAULT_SETTINGS, saved)` replaces the nested
	// backendWrapper object wholesale, so keys added later come back undefined for older data.json files.
	test.fails("[F15] old data.json without backendWrapper.showDecryptModal keeps the default (deep merge)", async () => {
		h = await bootWithData({
			firstLoad: false,
			backendWrapper: { executable: "gpg", recipient: "", trustModelAlways: false, compression: false, cache: true },
		});
		expect(h.settings().backendWrapper.showDecryptModal).toBe(true);
	});
});

describe("loadKeypair (main.ts:1026-1031)", () => {
	test("keys present in the vault are loaded on layout ready", async () => {
		h = await createPluginHarness({ keys: "pw" });
		expect(h.plugin.gpgNative.hasPublicKey()).toBe(true);
		expect(h.plugin.gpgNative.hasPrivateKey()).toBe(true);
		expect(h.plugin.gpgNative.isPrivateKeyEncrypted()).toBe(true);
	});

	test("missing key files fall back to fetch(getResourcePath) and end up as null keys without throwing", async () => {
		const fetchMock = vi.fn(async () => ({ text: async () => "" }));
		vi.stubGlobal("fetch", fetchMock);

		h = await createPluginHarness({ keys: null });

		expect(fetchMock).toHaveBeenCalledWith("app://local/public.asc");
		expect(fetchMock).toHaveBeenCalledWith("app://local/private.asc");
		expect(h.plugin.gpgNative.hasPublicKey()).toBe(false);
		expect(h.plugin.gpgNative.hasPrivateKey()).toBe(false);
	});

	test("a rejected fetch (e.g. unsupported scheme) is swallowed as well", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("nope"); }));
		h = await createPluginHarness({ keys: null });
		expect(h.plugin.gpgNative.hasPublicKey()).toBe(false);
		expect(h.plugin.gpgNative.hasPrivateKey()).toBe(false);
	});
});

describe("generateKeypair (main.ts:939-974)", () => {
	function fillGenerateModal(modal: GenerateKeypairModal, values: { publicKey: string; privateKey: string; passphrase: string }): void {
		const [name, email, publicKey, privateKey, passphrase, confirm] = Array.from(modal.contentEl.querySelectorAll("input"));
		name.value = "Test";
		email.value = "test@example.com";
		publicKey.value = values.publicKey;
		privateKey.value = values.privateKey;
		passphrase.value = values.passphrase;
		confirm.value = values.passphrase;
	}

	test("writes both armored key files, updates + saves the settings, loads the new keys and shows a Notice", async () => {
		stubFetchFromDisk(); // the freshly written key files are not indexed by the fake vault → external-file fallback
		h = await createPluginHarness({ keys: null });
		expect(h.plugin.gpgNative.hasPrivateKey()).toBe(false);

		const generating = h.plugin.generateKeypair();
		const modal = await waitForModal(GenerateKeypairModal);
		fillGenerateModal(modal, { publicKey: "k/pub.asc", privateKey: "k/priv.asc", passphrase: "x" });
		(modal.contentEl.querySelector("button.mod-cta") as HTMLButtonElement).click();

		expect(await generating).toBe(true);
		expect(h.disk("k/pub.asc")!.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----")).toBe(true);
		expect(h.disk("k/priv.asc")!.startsWith("-----BEGIN PGP PRIVATE KEY BLOCK-----")).toBe(true);
		expect(h.settings().backendNative).toEqual({ publicKeyPath: "k/pub.asc", privateKeyPath: "k/priv.asc" });
		expect(h.savedData().backendNative).toEqual({ publicKeyPath: "k/pub.asc", privateKeyPath: "k/priv.asc" });
		expect(Notice.messages()).toContain("Key pair successfully created!");
		expect(h.plugin.gpgNative.hasPublicKey()).toBe(true);
		expect(h.plugin.gpgNative.hasPrivateKey()).toBe(true);
		expect(h.plugin.gpgNative.isPrivateKeyEncrypted()).toBe(true);
	});

	test("refuses to overwrite an existing key file", async () => {
		h = await createPluginHarness({ files: { "k/pub.asc": "already here" } });
		const before = { ...h.settings().backendNative };

		const generating = h.plugin.generateKeypair();
		const modal = await waitForModal(GenerateKeypairModal);
		fillGenerateModal(modal, { publicKey: "k/pub.asc", privateKey: "k/priv.asc", passphrase: "" });
		(modal.contentEl.querySelector("button.mod-cta") as HTMLButtonElement).click();

		expect(await generating).toBe(false);
		expect(Notice.messages().some((m) => m.includes("already existing"))).toBe(true);
		expect(h.disk("k/pub.asc")).toBe("already here");
		expect(h.disk("k/priv.asc")).toBeUndefined();
		expect(h.settings().backendNative).toEqual(before);
	});

	test("cancelling the modal → Notice 'aborted', returns false", async () => {
		h = await createPluginHarness();
		const generating = h.plugin.generateKeypair();
		const modal = await waitForModal(GenerateKeypairModal);
		clickButton(modal, "Cancel");

		expect(await generating).toBe(false);
		expect(Notice.messages().some((m) => m.includes("aborted"))).toBe(true);
	});

	// F31: the "must not be empty" guard (main.ts:943) is dead —
	// GenerateKeypairModal runs the file names through normalizePath(), and normalizePath("") is "/" (truthy,
	// same as in Obsidian). The generation proceeds with "/" as key path.
	test.fails("[F33] empty key file names are rejected with 'Key file names must not be empty'", async () => {
		h = await createPluginHarness();
		const generating = h.plugin.generateKeypair();
		const modal = await waitForModal(GenerateKeypairModal);
		fillGenerateModal(modal, { publicKey: "", privateKey: "", passphrase: "" });
		(modal.contentEl.querySelector("button.mod-cta") as HTMLButtonElement).click();

		expect(await generating).toBe(false);
		expect(Notice.messages().some((m) => m.includes("must not be empty"))).toBe(true);
	});
});
