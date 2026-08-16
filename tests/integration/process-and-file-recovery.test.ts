/**
 * `hookedAdapterProcess` (main.ts:511-538) and the File Recovery integration: `hookedVaultCachedRead`,
 * `hookedFileRecoveryOnFileChange`, `hookedFileRecoveryForceAdd` (main.ts:540-602) driven through
 * the fake core plugin instance (`app.fileRecovery`, registered on vault "modify" / workspace "file-open").
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { TFile } from "obsidian";
import { createPluginHarness, flush, waitFor, type Harness } from "../helpers/plugin-harness";
import { CIPHERTEXT_NOPASS, PLAINTEXT, isArmoredMessage } from "../helpers/fixtures";

let h: Harness | undefined;
afterEach(async () => {
	await flush(20); // let background file-recovery chains settle before the hooks are removed
	await h?.unload();
	h = undefined;
});

async function decryptDisk(harness: Harness, path: string): Promise<string> {
	return harness.plugin.gpgNative.decrypt(harness.disk(path)!, null);
}
const snapshots = () => h!.app.fileRecovery!.snapshots;

type Recovery = { onFileChanged: ReturnType<typeof vi.fn>; forceAdd: ReturnType<typeof vi.fn> };
/**
 * The plugin patches `app.fileRecovery` (the core plugin instance) in place, so the original vi.fns must be
 * captured before onload to assert on them afterwards.
 */
async function bootWithRecovery(options: Parameters<typeof createPluginHarness>[0] = {}): Promise<{ h: Harness; original: Recovery }> {
	const harness = await createPluginHarness({ ...options, load: false });
	const original = { onFileChanged: harness.app.fileRecovery!.onFileChanged, forceAdd: harness.app.fileRecovery!.forceAdd } as Recovery;
	await harness.plugin.onload();
	await harness.app.workspace.setLayoutReady__();
	return { h: harness, original };
}

describe("hookedAdapterProcess: vault.process()", () => {
	test("encrypted note (status known): fn receives the plaintext, the disk receives ciphertext of fn's output", async () => {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS } });
		const file = h.app.vault.getFileByPath("Encrypted.md")!;
		await h.app.vault.read(file);

		const seen: string[] = [];
		await h.app.vault.process(file, (data) => {
			seen.push(data);
			return data + "appended\n";
		});

		expect(seen).toEqual([PLAINTEXT]);
		expect(isArmoredMessage(h.disk("Encrypted.md"))).toBe(true);
		expect(await decryptDisk(h, "Encrypted.md")).toBe(PLAINTEXT + "appended\n");
	});

	test("encrypted note never read before: the hook reads it first and behaves the same", async () => {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS } });
		const file = h.app.vault.getFileByPath("Encrypted.md")!;

		const seen: string[] = [];
		await h.app.vault.process(file, (data) => {
			seen.push(data);
			return "replaced\n";
		});

		expect(seen).toEqual([PLAINTEXT]);
		expect(isArmoredMessage(h.disk("Encrypted.md"))).toBe(true);
		expect(await decryptDisk(h, "Encrypted.md")).toBe("replaced\n");
		// the note is now tracked as encrypted
		h.app.workspace.setActiveFile__(file);
		expect(h.plugin.commands__["gpg-crypt:gpg-decrypt-permanently"].checkCallback!(true)).toBe(true);
		expect(h.plugin.commands__["gpg-crypt:gpg-encrypt-permanently"].checkCallback!(true)).toBe(false);
	});

	test("plaintext note: fn runs on the plaintext and the disk stays plaintext", async () => {
		h = await createPluginHarness({ files: { "Plain.md": "hello\n" } });
		const file = h.app.vault.getFileByPath("Plain.md")!;

		const seen: string[] = [];
		const result = await h.app.vault.process(file, (data) => {
			seen.push(data);
			return data + "more\n";
		});

		expect(seen).toEqual(["hello\n"]);
		expect(result).toBe("hello\nmore\n");
		expect(h.disk("Plain.md")).toBe("hello\nmore\n");
	});

	// F08: for encrypted notes the user callback is executed BEFORE the adapter's
	// atomic read-modify-write, on content read earlier, and the adapter receives a constant closure that
	// ignores the `data` it is handed (TOCTOU). Documents the current behaviour.
	test("[F08] encrypted note: fn runs before adapter.process and the callback handed to the adapter ignores its argument", async () => {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS }, load: false });
		const adapter = h.app.vault.adapter;
		const realProcess = adapter.process;
		const order: string[] = [];
		const handedCallbacks: ((data: string) => string)[] = [];
		adapter.process = async (path, fn, options) => {
			order.push("adapter.process");
			handedCallbacks.push(fn);
			return realProcess.call(adapter, path, fn, options);
		};
		await h.plugin.onload();
		await h.app.workspace.setLayoutReady__();

		const file = h.app.vault.getFileByPath("Encrypted.md")!;
		await h.app.vault.read(file);
		const result = await h.app.vault.process(file, (data) => {
			order.push(`fn(${JSON.stringify(data)})`);
			return "replaced\n";
		});

		expect(order).toEqual([`fn(${JSON.stringify(PLAINTEXT)})`, "adapter.process"]);
		expect(handedCallbacks).toHaveLength(1);
		const handed = handedCallbacks[0];
		const onDisk = h.disk("Encrypted.md")!;
		expect(isArmoredMessage(onDisk)).toBe(true);
		// whatever the adapter passes in, the pre-computed ciphertext comes back
		expect(handed("different")).toBe(onDisk);
		expect(handed("")).toBe(onDisk);
		expect(await h.plugin.gpgNative.decrypt(onDisk, null)).toBe("replaced\n");
		// side effect: vault.process() resolves with the ciphertext, not with fn's output
		expect(result).toBe(onDisk);
	});
});

describe("file recovery: hookedFileRecoveryOnFileChange + hookedVaultCachedRead", () => {
	test("fileRecovery=encrypted (default): the snapshot of a modified encrypted note is ciphertext", async () => {
		const booted = await bootWithRecovery({ files: { "Encrypted.md": CIPHERTEXT_NOPASS }, settings: { encryptAll: true } });
		h = booted.h;
		expect(h.settings().fileRecovery).toBe("encrypted");
		const file = h.app.vault.getFileByPath("Encrypted.md")!;
		await h.app.vault.read(file);

		await h.app.vault.modify(file, "edited\n");
		await waitFor(() => snapshots().length > 0);

		expect(booted.original.onFileChanged).toHaveBeenCalledWith(file);
		expect(snapshots()).toHaveLength(1);
		expect(snapshots()[0].path).toBe("Encrypted.md");
		expect(isArmoredMessage(snapshots()[0].content)).toBe(true);
		expect(await h.plugin.gpgNative.decrypt(snapshots()[0].content, null)).toBe("edited\n");
		expect(snapshots()[0].content).not.toBe(h.disk("Encrypted.md")); // re-encrypted from plaintext, not copied
	});

	test("fileRecovery=plaintext: the snapshot is plaintext", async () => {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS }, settings: { encryptAll: true, fileRecovery: "plaintext" } });
		const file = h.app.vault.getFileByPath("Encrypted.md")!;
		await h.app.vault.read(file);

		await h.app.vault.modify(file, "edited\n");
		await waitFor(() => snapshots().length > 0);

		expect(isArmoredMessage(h.disk("Encrypted.md"))).toBe(true);
		expect(snapshots()).toEqual([{ path: "Encrypted.md", content: "edited\n" }]);
	});

	test("fileRecovery=skip: encrypted notes are not passed to file recovery, plaintext notes still are", async () => {
		// encryption scoped to "secret/" so that Plain.md stays plaintext when saved
		const booted = await bootWithRecovery({
			files: { "secret/Encrypted.md": CIPHERTEXT_NOPASS, "Plain.md": "plain\n" },
			settings: { foldersToEncrypt: ["secret"], fileRecovery: "skip" },
		});
		h = booted.h;
		const encrypted = h.app.vault.getFileByPath("secret/Encrypted.md")!;
		const plain = h.app.vault.getFileByPath("Plain.md")!;
		await h.app.vault.read(encrypted);
		await h.app.vault.read(plain);

		await h.app.vault.modify(encrypted, "edited\n");
		await flush(20);
		expect(isArmoredMessage(h.disk("secret/Encrypted.md"))).toBe(true);
		expect(booted.original.onFileChanged).not.toHaveBeenCalled();
		expect(snapshots()).toEqual([]);
		// the hook itself resolves with null for skipped notes
		expect(await h.app.internalPlugins.plugins["file-recovery"]!.instance.onFileChanged(encrypted)).toBeNull();

		// plaintext note → passed through as usual
		await h.app.vault.modify(plain, "edited plain\n");
		await waitFor(() => snapshots().length > 0);
		expect(h.disk("Plain.md")).toBe("edited plain\n");
		expect(booted.original.onFileChanged).toHaveBeenCalledWith(plain);
		expect(snapshots()).toEqual([{ path: "Plain.md", content: "edited plain\n" }]);
	});

	test("a note whose status is unknown is read first (status resolved from disk)", async () => {
		const booted = await bootWithRecovery({ files: { "Encrypted.md": CIPHERTEXT_NOPASS }, settings: { fileRecovery: "skip" } });
		h = booted.h;
		const file = h.app.vault.getFileByPath("Encrypted.md")!;

		// no vault.read before: file-open (e.g. opening the note) hands the file to file recovery
		h.app.workspace.setActiveFile__(file);
		await flush(20);

		expect(booted.original.onFileChanged).not.toHaveBeenCalled(); // resolved to "encrypted" → skipped
		expect(h.plugin.commands__["gpg-crypt:gpg-decrypt-permanently"].checkCallback!(true)).toBe(true);
	});

	test("onFileChanged(null) passes through to the original without throwing", async () => {
		const booted = await bootWithRecovery();
		h = booted.h;
		const instance = h.app.internalPlugins.plugins["file-recovery"]!.instance;

		await expect(instance.onFileChanged(null)).resolves.toBeNull();
		expect(booted.original.onFileChanged).toHaveBeenCalledWith(null);

		// same via the workspace event Obsidian fires when the last leaf is closed
		h.app.workspace.setActiveFile__(null);
		await flush();
		expect(booted.original.onFileChanged).toHaveBeenCalledTimes(2);
	});

	test("forceAdd passes through to the original with the same arguments", async () => {
		const booted = await bootWithRecovery();
		h = booted.h;
		const instance = h.app.internalPlugins.plugins["file-recovery"]!.instance;

		await instance.forceAdd("some/note.md", "content\n");

		expect(booted.original.forceAdd).toHaveBeenCalledWith("some/note.md", "content\n");
		expect(snapshots()).toEqual([{ path: "some/note.md", content: "content\n" }]);
	});

	test("after the file-recovery run the marker is cleared: cachedRead returns plaintext again", async () => {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS }, settings: { encryptAll: true } });
		const file = h.app.vault.getFileByPath("Encrypted.md")!;
		await h.app.vault.read(file);

		await h.app.vault.modify(file, "edited\n");
		await waitFor(() => snapshots().length > 0);
		await flush();

		expect(isArmoredMessage(h.disk("Encrypted.md"))).toBe(true);
		expect(await h.app.vault.cachedRead(file)).toBe("edited\n");
		expect(await h.app.vault.read(file)).toBe("edited\n");
	});

	// F09: the marker lives on the shared TFile for the whole duration of the original
	// onFileChanged; any other cachedRead in that window gets ciphertext. The fake's onFileChanged is made slow
	// (installed before the plugin captures it, re-registered like Obsidian does) to open that window.
	test.fails("[F09] another cachedRead during the file-recovery snapshot does not receive ciphertext", async () => {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS }, settings: { encryptAll: true }, load: false });
		const app = h.app;
		const recovery = app.fileRecovery!;
		const fast = recovery.onFileChanged;
		const slow = async (file: TFile | null) => {
			await new Promise((r) => setTimeout(r, 50));
			return fast(file);
		};
		app.vault.off("modify", fast);
		app.workspace.off("file-open", fast);
		recovery.onFileChanged = slow;
		app.vault.on("modify", slow);
		app.workspace.on("file-open", slow);

		await h.plugin.onload();
		await app.workspace.setLayoutReady__();

		const file = app.vault.getFileByPath("Encrypted.md")!;
		await app.vault.read(file);
		await app.vault.modify(file, "edited\n"); // "modify" → hooked onFileChanged → marker set → slow original in flight

		const concurrent = await app.vault.cachedRead(file);
		await waitFor(() => recovery.snapshots.length > 0);

		expect(isArmoredMessage(recovery.snapshots[0].content)).toBe(true); // file recovery still gets ciphertext
		expect(concurrent).toBe("edited\n"); // …but a bystander must get plaintext
	});
});
