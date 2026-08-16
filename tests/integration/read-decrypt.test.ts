/**
 * The read side of gpgCrypt: `hookedAdapterRead` / `hookedAdapterReadBinary` (main.ts:351-451), the
 * decryption cache, the passphrase flow of `decrypt()` (main.ts:703-773 / 775-794) and the wrapper
 * backend dispatch of `encrypt()` / `decrypt()` — all driven through the real `GpgPlugin` against
 * the fake App.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { Modal, Notice, Platform } from "obsidian";
import * as openpgp from "openpgp";
import { createPluginHarness, flush, waitFor, type Harness } from "../helpers/plugin-harness";
import { CIPHERTEXT_NOPASS, CIPHERTEXT_PW, KEYS, PLAINTEXT } from "../helpers/fixtures";
import PassphraseModal from "src/modals/PassphraseModal";
import WrapperDecryptModal from "src/modals/WrapperDecryptModal";

let h: Harness | undefined;
afterEach(async () => {
	await h?.unload();
	h = undefined;
});

/** newest still-open modal of the given class */
function openModal<T extends Modal>(ctor: new (...args: any[]) => T): T | undefined {
	return [...Modal.opened__].reverse().find((m): m is T => m instanceof ctor && m.isOpen__);
}
async function waitForModal<T extends Modal>(ctor: new (...args: any[]) => T): Promise<T> {
	await waitFor(() => openModal(ctor) !== undefined);
	return openModal(ctor)!;
}
function submitPassphrase(modal: PassphraseModal, passphrase: string): void {
	(modal.contentEl.querySelector("input[type=password]") as HTMLInputElement).value = passphrase;
	(modal.contentEl.querySelector("button.mod-cta") as HTMLButtonElement).click();
}
function cancelPassphrase(modal: PassphraseModal): void {
	Array.from(modal.contentEl.querySelectorAll("button"))
		.find((b) => b.textContent === "Cancel")!
		.click();
}
function passphraseModals(): PassphraseModal[] {
	return Modal.opened__.filter((m): m is PassphraseModal => m instanceof PassphraseModal);
}
async function encryptFor(publicKey: string, text: string): Promise<string> {
	return openpgp.encrypt({
		message: await openpgp.createMessage({ text }),
		encryptionKeys: await openpgp.readKey({ armoredKey: publicKey }),
	});
}

describe("hookedAdapterRead: transparent decryption and status tracking", () => {
	test("reading an encrypted note returns the plaintext and marks the note as encrypted", async () => {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS } });
		const file = h.app.vault.getFileByPath("Encrypted.md")!;

		expect(await h.app.vault.read(file)).toBe("Hello secret world\n");
		expect(h.disk("Encrypted.md")).toBe(CIPHERTEXT_NOPASS); // the disk is untouched by a read

		h.app.workspace.setActiveFile__(file);
		expect(h.plugin.commands__["gpg-crypt:gpg-encrypt-permanently"].checkCallback!(true)).toBe(false);
		expect(h.plugin.commands__["gpg-crypt:gpg-decrypt-permanently"].checkCallback!(true)).toBe(true);
	});

	test("reading a plaintext note returns it unchanged and marks it as plaintext", async () => {
		h = await createPluginHarness({ files: { "Plain.md": "just text\n" } });
		const file = h.app.vault.getFileByPath("Plain.md")!;

		expect(await h.app.vault.read(file)).toBe("just text\n");

		h.app.workspace.setActiveFile__(file);
		expect(h.plugin.commands__["gpg-crypt:gpg-encrypt-permanently"].checkCallback!(true)).toBe(true);
		expect(h.plugin.commands__["gpg-crypt:gpg-decrypt-permanently"].checkCallback!(true)).toBe(false);
	});

	test("two concurrent reads of the same encrypted note share one decryption (F16 area)", async () => {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS } });
		const file = h.app.vault.getFileByPath("Encrypted.md")!;
		const decrypt = vi.spyOn(h.plugin.gpgNative, "decrypt");

		const [a, b] = await Promise.all([h.app.vault.read(file), h.app.vault.read(file)]);

		expect(a).toBe(PLAINTEXT);
		expect(b).toBe(PLAINTEXT);
		expect(decrypt).toHaveBeenCalledTimes(1);
	});
});

describe("decryptionCache eviction (main.ts:376-396)", () => {
	test("backendWrapper.cache=false: the entry is kept for ~500 ms, afterwards a read decrypts again", async () => {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS }, settings: { backendWrapper: { cache: false } } });
		const file = h.app.vault.getFileByPath("Encrypted.md")!;
		const decrypt = vi.spyOn(h.plugin.gpgNative, "decrypt");

		await h.app.vault.read(file);
		await h.app.vault.read(file); // within the 500 ms grace period → still served from the cache
		expect(decrypt).toHaveBeenCalledTimes(1);

		await flush(600);
		expect(await h.app.vault.read(file)).toBe(PLAINTEXT);
		expect(decrypt).toHaveBeenCalledTimes(2);
	});

	// F14: the wrapper-scoped "cache" flag also keeps the plaintext promise of the
	// OpenPGP.js backend for the whole session. Documents the current behaviour.
	test("[F14] decrypted content is cached for the whole session when backendWrapper.cache=true (also for the native backend)", async () => {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS } });
		expect(h.settings().backendWrapper.cache).toBe(true);
		expect(h.settings().backend).toBe("native");
		const file = h.app.vault.getFileByPath("Encrypted.md")!;
		const decrypt = vi.spyOn(h.plugin.gpgNative, "decrypt");

		await h.app.vault.read(file);
		await flush(600);
		expect(await h.app.vault.read(file)).toBe(PLAINTEXT);
		expect(decrypt).toHaveBeenCalledTimes(1);
	});
});

describe("hookedAdapterReadBinary (main.ts:403-451)", () => {
	const decode = (buf: ArrayBuffer | Uint8Array) => new TextDecoder().decode(buf instanceof Uint8Array ? buf : new Uint8Array(buf));

	// The fake adapter's readBinary delegates to the instance `read` (looked up at call time, i.e. the
	// HOOKED read once the plugin is loaded) — Obsidian's FileSystemAdapter reads the bytes directly.
	// Install a raw readBinary before the plugin captures its originals so the hook sees ciphertext bytes.
	async function harnessWithRawReadBinary(settings: Record<string, unknown> = {}): Promise<Harness> {
		const harness = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS }, settings, load: false });
		const adapter = harness.app.vault.adapter;
		adapter.readBinary = async (p) => new TextEncoder().encode(adapter.files.get(p)!).buffer as ArrayBuffer;
		await harness.plugin.onload();
		await harness.app.workspace.setLayoutReady__();
		return harness;
	}

	test("compatibilityMode=false: readBinary returns the raw ciphertext bytes", async () => {
		h = await harnessWithRawReadBinary();
		const file = h.app.vault.getFileByPath("Encrypted.md")!;

		const result = await h.app.vault.readBinary(file);
		expect(result).toBeInstanceOf(ArrayBuffer);
		expect(decode(result)).toBe(CIPHERTEXT_NOPASS);
	});

	test("compatibilityMode=true: readBinary returns the decrypted bytes", async () => {
		h = await harnessWithRawReadBinary({ compatibilityMode: true });
		const file = h.app.vault.getFileByPath("Encrypted.md")!;

		const result = await h.app.vault.readBinary(file);
		expect(decode(result)).toBe(PLAINTEXT);
	});

	// F11: the cache-hit branch (main.ts:429) returns a Uint8Array, the miss branch (:450) an ArrayBuffer.
	test.fails("[F11] readBinary returns an ArrayBuffer on cache hit too", async () => {
		h = await harnessWithRawReadBinary({ compatibilityMode: true });
		const file = h.app.vault.getFileByPath("Encrypted.md")!;

		const first = await h.app.vault.readBinary(file);
		expect(first).toBeInstanceOf(ArrayBuffer);

		const second = await h.app.vault.readBinary(file); // served from decryptionCache
		expect(decode(second)).toBe(PLAINTEXT);
		expect(second).toBeInstanceOf(ArrayBuffer);
	});
});

describe("passphrase-protected private key (keys: pw)", () => {
	test("reading an encrypted note prompts for the passphrase; entering it resolves the read and caches it", async () => {
		h = await createPluginHarness({ keys: "pw", files: { "Encrypted.md": CIPHERTEXT_PW } });
		const file = h.app.vault.getFileByPath("Encrypted.md")!;

		const read = h.app.vault.read(file);
		const modal = await waitForModal(PassphraseModal);
		expect(modal.contentEl.textContent).toContain("Enter passphrase");
		submitPassphrase(modal, "test");

		expect(await read).toBe(PLAINTEXT);
		expect(modal.isOpen__).toBe(false);
		expect(h.plugin.cache.hasPassphrase()).toBe(true);

		// a second, differently encrypted note is decrypted with the cached passphrase — no prompt
		h.app.vault.seed__({ "Second.md": await encryptFor(KEYS.pw.publicKey, "second\n") });
		expect(await h.app.vault.read(h.app.vault.getFileByPath("Second.md")!)).toBe("second\n");
		expect(passphraseModals()).toHaveLength(1);
	});

	test("a wrong passphrase shows a Notice and re-prompts; the correct one then resolves the read", async () => {
		h = await createPluginHarness({ keys: "pw", files: { "Encrypted.md": CIPHERTEXT_PW } });
		const file = h.app.vault.getFileByPath("Encrypted.md")!;

		const read = h.app.vault.read(file);
		const first = await waitForModal(PassphraseModal);
		submitPassphrase(first, "wrong");

		await waitFor(() => Notice.messages().some((m) => m.includes("Incorrect key passphrase")));
		const second = await waitForModal(PassphraseModal);
		expect(second).not.toBe(first);
		expect(passphraseModals()).toHaveLength(2);

		submitPassphrase(second, "test");
		expect(await read).toBe(PLAINTEXT);
		expect(h.plugin.cache.hasPassphrase()).toBe(true);
	});

	test("Cancel rejects the read with 'No passphrase …' and does not prompt again", async () => {
		h = await createPluginHarness({ keys: "pw", files: { "Encrypted.md": CIPHERTEXT_PW } });
		const file = h.app.vault.getFileByPath("Encrypted.md")!;

		const read = h.app.vault.read(file);
		const modal = await waitForModal(PassphraseModal);
		cancelPassphrase(modal);

		await expect(read).rejects.toThrow(/No passphrase/);
		await flush();
		expect(passphraseModals()).toHaveLength(1);
		expect(openModal(PassphraseModal)).toBeUndefined();
		expect(h.plugin.cache.hasPassphrase()).toBe(false);
	});

	// F07: with a wrong passphrase in the cache the retry loop (main.ts:748-772)
	// keeps re-reading the cached value, never shows the modal and spins forever (one Notice per turn).
	// The spy bounds the loop for the test; a fixed plugin either re-prompts or gives up early.
	test.fails("[F07] a wrong CACHED passphrase re-prompts instead of looping forever", async () => {
		h = await createPluginHarness({ keys: "pw", files: { "Encrypted.md": CIPHERTEXT_PW } });
		const file = h.app.vault.getFileByPath("Encrypted.md")!;
		h.plugin.cache.setPassphrase("wrong");

		const realDecrypt = h.plugin.gpgNative.decrypt.bind(h.plugin.gpgNative);
		let calls = 0;
		const decrypt = vi.spyOn(h.plugin.gpgNative, "decrypt").mockImplementation(async (text, passphrase) => {
			if (++calls > 5) throw new Error("Session key decryption failed.");
			return realDecrypt(text, passphrase);
		});

		const outcome = await Promise.race([
			h.app.vault.read(file).then(
				() => "resolved",
				() => "rejected",
			),
			new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 3000)),
		]);
		expect(outcome).not.toBe("timeout");

		const prompted = passphraseModals().length > 0;
		expect(prompted || decrypt.mock.calls.length <= 2).toBe(true);
	});
});

describe("decrypt() error paths", () => {
	test("a note encrypted for another key rejects the read with exactly one Notice and no retry loop", async () => {
		h = await createPluginHarness({ keys: "nopass", files: { "ForOtherKey.md": CIPHERTEXT_PW } });
		const file = h.app.vault.getFileByPath("ForOtherKey.md")!;
		const decrypt = vi.spyOn(h.plugin.gpgNative, "decrypt");

		await expect(h.app.vault.read(file)).rejects.toThrow(/No decryption key packets found/);
		await flush();

		expect(decrypt).toHaveBeenCalledTimes(1);
		expect(Notice.messages().filter((m) => m.includes("No decryption key packets found"))).toHaveLength(1);
		expect(passphraseModals()).toHaveLength(0);
	});
});

describe("wrapper backend: decrypt() dispatch (main.ts:705-740)", () => {
	const wrapperSettings = (extra: Record<string, unknown> = {}) => ({
		backend: "wrapper",
		backendWrapper: { recipient: KEYS.nopass.keyId, trustModelAlways: true, ...extra },
	});
	const fakeDecryption = () => ({ gpgResult: Promise.resolve({ result: Buffer.from("plain") }), kill: vi.fn() });

	// F05: `args` is built with "--trust-model always" (main.ts:717-720) but
	// `initDecrypt(encryptedText)` is called without it (:723).
	test.fails("[F05] --trust-model always is passed to gpg on decrypt when trustModelAlways is set", async () => {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS }, settings: wrapperSettings() });
		const initDecrypt = vi.spyOn(h.plugin.gpgWrapper, "initDecrypt").mockReturnValue(fakeDecryption());
		const file = h.app.vault.getFileByPath("Encrypted.md")!;

		expect(await h.app.vault.read(file)).toBe("plain");
		expect(initDecrypt).toHaveBeenCalledTimes(1);
		expect(initDecrypt).toHaveBeenCalledWith(CIPHERTEXT_NOPASS, expect.arrayContaining(["--trust-model", "always"]));
	});

	test("showDecryptModal=true: a WrapperDecryptModal is shown during decryption and closed afterwards", async () => {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS }, settings: wrapperSettings({ showDecryptModal: true }) });
		vi.spyOn(h.plugin.gpgWrapper, "initDecrypt").mockReturnValue(fakeDecryption());
		const file = h.app.vault.getFileByPath("Encrypted.md")!;

		expect(await h.app.vault.read(file)).toBe("plain");

		const modal = Modal.opened__.find((m) => m instanceof WrapperDecryptModal);
		expect(modal).toBeDefined();
		expect(modal!.isOpen__).toBe(false);
	});

	test("showDecryptModal=false: no modal is shown", async () => {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS }, settings: wrapperSettings({ showDecryptModal: false }) });
		vi.spyOn(h.plugin.gpgWrapper, "initDecrypt").mockReturnValue(fakeDecryption());
		const file = h.app.vault.getFileByPath("Encrypted.md")!;

		expect(await h.app.vault.read(file)).toBe("plain");
		expect(Modal.opened__.some((m) => m instanceof WrapperDecryptModal)).toBe(false);
	});
});

describe("wrapper backend: encrypt() dispatch (main.ts:674-700)", () => {
	async function wrapperHarness(backendWrapper: Record<string, unknown>): Promise<Harness> {
		return createPluginHarness({ settings: { backend: "wrapper", backendWrapper: { recipient: KEYS.nopass.keyId, ...backendWrapper } } });
	}

	test("valid recipient → gpg is called with --armor --recipient <id> --compression-algo none", async () => {
		h = await wrapperHarness({});
		const encrypt = vi.spyOn(h.plugin.gpgWrapper, "encrypt").mockResolvedValue("CIPHER");

		expect(await h.plugin.encrypt("hi")).toBe("CIPHER");
		expect(encrypt).toHaveBeenCalledWith("hi", ["--armor", "--recipient", KEYS.nopass.keyId, "--compression-algo", "none"]);
	});

	test("compression → --compression-algo zlib; trustModelAlways → --trust-model always", async () => {
		h = await wrapperHarness({ compression: true, trustModelAlways: true });
		const encrypt = vi.spyOn(h.plugin.gpgWrapper, "encrypt").mockResolvedValue("CIPHER");

		await h.plugin.encrypt("hi");
		expect(encrypt).toHaveBeenCalledWith("hi", ["--armor", "--recipient", KEYS.nopass.keyId, "--compression-algo", "zlib", "--trust-model", "always"]);
	});

	test("empty recipient → throws 'No valid recipient configured.'", async () => {
		h = await wrapperHarness({ recipient: "" });
		const encrypt = vi.spyOn(h.plugin.gpgWrapper, "encrypt");

		await expect(h.plugin.encrypt("hi")).rejects.toThrow("No valid recipient configured.");
		expect(encrypt).not.toHaveBeenCalled();
	});

	test("recipient that is not a key id (argument injection) → throws, gpg is not spawned", async () => {
		h = await wrapperHarness({ recipient: "--x" });
		const encrypt = vi.spyOn(h.plugin.gpgWrapper, "encrypt");

		await expect(h.plugin.encrypt("hi")).rejects.toThrow("No valid recipient configured.");
		expect(encrypt).not.toHaveBeenCalled();
	});

	test("Platform.isMobile → throws 'not supported on mobile devices'", async () => {
		h = await wrapperHarness({});
		const encrypt = vi.spyOn(h.plugin.gpgWrapper, "encrypt");
		Platform.isMobile = true;

		await expect(h.plugin.encrypt("hi")).rejects.toThrow(/not supported on mobile devices/);
		await expect(h.plugin.decrypt("x.md", CIPHERTEXT_NOPASS)).rejects.toThrow(/not supported on mobile devices/);
		expect(encrypt).not.toHaveBeenCalled();
	});
});
