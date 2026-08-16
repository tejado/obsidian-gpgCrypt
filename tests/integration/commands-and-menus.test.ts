/**
 * User-facing entry points: the two commands (main.ts:248-300), `persistentFileEncrypt` /
 * `persistentFileDecrypt` (main.ts:810-881), the file/folder context menu handlers (main.ts:189-246)
 * and `encryptAllFilesInPath` (main.ts:796-808).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { Menu, Modal, Notice, TAbstractFile } from "obsidian";
import { createPluginHarness, flush, waitFor, type Harness } from "../helpers/plugin-harness";
import { CIPHERTEXT_NOPASS, PLAINTEXT, isArmoredMessage } from "../helpers/fixtures";
import DialogModal from "src/modals/DialogModal";

let h: Harness | undefined;
afterEach(async () => {
	await flush(20);
	await h?.unload();
	h = undefined;
});

async function decryptDisk(harness: Harness, path: string): Promise<string> {
	return harness.plugin.gpgNative.decrypt(harness.disk(path)!, null);
}
const encryptCmd = () => h!.plugin.commands__["gpg-crypt:gpg-encrypt-permanently"].checkCallback!;
const decryptCmd = () => h!.plugin.commands__["gpg-crypt:gpg-decrypt-permanently"].checkCallback!;
const statusBar = () => h!.plugin.statusBarItems__[0];
function fileMenu(target: TAbstractFile): Menu {
	const menu = new Menu();
	h!.app.workspace.trigger("file-menu", menu, target);
	return menu;
}

describe("commands: checkCallback availability", () => {
	test("no active file → both commands unavailable", async () => {
		h = await createPluginHarness({ files: { "Plain.md": "hello\n" } });
		expect(h.app.workspace.getActiveFile()).toBeNull();
		expect(encryptCmd()(true)).toBe(false);
		expect(decryptCmd()(true)).toBe(false);
	});

	test("active file that is neither .md nor .gpg → both unavailable", async () => {
		h = await createPluginHarness({ files: { "img.png": "PNG" } });
		h.app.workspace.setActiveFile__(h.app.vault.getFileByPath("img.png")!);
		await flush();
		expect(encryptCmd()(true)).toBe(false);
		expect(decryptCmd()(true)).toBe(false);
	});

	test("unknown status (note not read yet) → BOTH commands are offered; plaintext → encrypt only; encrypted → decrypt only", async () => {
		h = await createPluginHarness({ files: { "Plain.md": "hello\n", "Encrypted.md": CIPHERTEXT_NOPASS } });
		const plain = h.app.vault.getFileByPath("Plain.md")!;
		const encrypted = h.app.vault.getFileByPath("Encrypted.md")!;

		// Right after activation the plugin has not read the note yet (isEncrypted === undefined) →
		// neither command is filtered out. (The "file-open" event triggers a read in the background.)
		h.app.workspace.setActiveFile__(plain);
		expect(encryptCmd()(true)).toBe(true);
		expect(decryptCmd()(true)).toBe(true);

		await h.app.vault.read(plain);
		expect(encryptCmd()(true)).toBe(true);
		expect(decryptCmd()(true)).toBe(false);

		h.app.workspace.setActiveFile__(encrypted);
		await h.app.vault.read(encrypted);
		expect(encryptCmd()(true)).toBe(false);
		expect(decryptCmd()(true)).toBe(true);
	});

	test("a .gpg note is handled like a .md note", async () => {
		h = await createPluginHarness({ files: { "Note.gpg": CIPHERTEXT_NOPASS } });
		const file = h.app.vault.getFileByPath("Note.gpg")!;
		h.app.workspace.setActiveFile__(file);
		await h.app.vault.read(file);
		expect(encryptCmd()(true)).toBe(false);
		expect(decryptCmd()(true)).toBe(true);
	});
});

describe("commands: execution", () => {
	test("'Encrypt file permanently' encrypts the active plaintext note on disk, marks it and shows the status bar lock", async () => {
		h = await createPluginHarness({ files: { "Plain.md": "hello\n" } });
		const file = h.app.vault.getFileByPath("Plain.md")!;
		h.app.workspace.setActiveFile__(file);
		await h.app.vault.read(file);
		expect(statusBar().style.display).toBe("none");

		expect(encryptCmd()(false)).toBe(true);
		await waitFor(() => isArmoredMessage(h!.disk("Plain.md")));

		expect(await decryptDisk(h, "Plain.md")).toBe("hello\n");
		expect(encryptCmd()(true)).toBe(false);
		expect(decryptCmd()(true)).toBe(true);
		expect(statusBar().style.display).toBe("");
		expect(statusBar().getAttribute("aria-label")).toBe("Encrypted with key pair");
		expect(statusBar().querySelector("svg.lucide-lock")).not.toBeNull();
		// reading through the vault still yields the plaintext
		expect(await h.app.vault.read(file)).toBe("hello\n");
	});

	test("'Decrypt file permanently' writes the plaintext to disk, marks it and hides the status bar lock", async () => {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS } });
		const file = h.app.vault.getFileByPath("Encrypted.md")!;
		await h.app.vault.read(file);
		h.app.workspace.setActiveFile__(file); // status known → "file-open" refresh shows the lock
		expect(statusBar().style.display).toBe("");

		expect(decryptCmd()(false)).toBe(true);
		await waitFor(() => h!.disk("Encrypted.md") === PLAINTEXT);

		expect(encryptCmd()(true)).toBe(true);
		expect(decryptCmd()(true)).toBe(false);
		expect(statusBar().style.display).toBe("none");
	});
});

describe("persistentFileEncrypt / persistentFileDecrypt", () => {
	test("persistentFileEncrypt writes ciphertext (via the original write) and refreshes the status bar for the active file", async () => {
		h = await createPluginHarness({ files: { "Plain.md": "hello\n" } });
		const file = h.app.vault.getFileByPath("Plain.md")!;
		h.app.workspace.setActiveFile__(file);

		await h.plugin.persistentFileEncrypt(file);

		expect(isArmoredMessage(h.disk("Plain.md"))).toBe(true);
		expect(await decryptDisk(h, "Plain.md")).toBe("hello\n");
		expect(statusBar().style.display).toBe("");
		expect(Notice.messages()).toEqual([]);
	});

	test("persistentFileEncrypt on a non-active file does not touch the status bar", async () => {
		h = await createPluginHarness({ files: { "Plain.md": "hello\n", "Other.md": "other\n" } });
		h.app.workspace.setActiveFile__(h.app.vault.getFileByPath("Other.md")!);
		await flush();
		expect(statusBar().style.display).toBe("none");

		await h.plugin.persistentFileEncrypt(h.app.vault.getFileByPath("Plain.md")!);
		expect(isArmoredMessage(h.disk("Plain.md"))).toBe(true);
		expect(statusBar().style.display).toBe("none");
	});

	test("renameToGpg: persistentFileEncrypt renames the note to .gpg and writes the ciphertext under the new path", async () => {
		h = await createPluginHarness({ files: { "Plain.md": "hello\n" }, settings: { renameToGpg: true } });
		const file = h.app.vault.getFileByPath("Plain.md")!;

		await h.plugin.persistentFileEncrypt(file);

		expect(h.disk("Plain.md")).toBeUndefined();
		expect(h.app.vault.getFileByPath("Plain.md")).toBeNull();
		expect(isArmoredMessage(h.disk("Plain.gpg"))).toBe(true);
		expect(await decryptDisk(h, "Plain.gpg")).toBe("hello\n");
		expect(file.path).toBe("Plain.gpg");
		expect(Notice.messages()).toEqual([]);
	});

	test("persistentFileEncrypt on an already encrypted note → Notice 'already encrypted', disk unchanged", async () => {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS } });
		await h.plugin.persistentFileEncrypt(h.app.vault.getFileByPath("Encrypted.md")!);

		expect(Notice.messages().some((m) => m.includes("already encrypted"))).toBe(true);
		expect(h.disk("Encrypted.md")).toBe(CIPHERTEXT_NOPASS);
	});

	test("persistentFileDecrypt writes the plaintext to disk", async () => {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS } });
		const file = h.app.vault.getFileByPath("Encrypted.md")!;
		h.app.workspace.setActiveFile__(file);

		await h.plugin.persistentFileDecrypt(file);

		expect(h.disk("Encrypted.md")).toBe(PLAINTEXT);
		expect(statusBar().style.display).toBe("none");
		expect(Notice.messages()).toEqual([]);
		// the plugin now tracks it as plaintext
		expect(encryptCmd()(true)).toBe(true);
		expect(decryptCmd()(true)).toBe(false);
	});

	test("renameToGpg: persistentFileDecrypt renames .gpg back to .md", async () => {
		h = await createPluginHarness({ files: { "Note.gpg": CIPHERTEXT_NOPASS }, settings: { renameToGpg: true } });
		const file = h.app.vault.getFileByPath("Note.gpg")!;

		await h.plugin.persistentFileDecrypt(file);

		expect(h.disk("Note.gpg")).toBeUndefined();
		expect(h.disk("Note.md")).toBe(PLAINTEXT);
		expect(h.app.vault.getFileByPath("Note.md")).not.toBeNull();
		expect(file.path).toBe("Note.md");
	});

	test("persistentFileDecrypt on a plaintext note → Notice 'not encrypted', disk unchanged", async () => {
		h = await createPluginHarness({ files: { "Plain.md": "hello\n" } });
		await h.plugin.persistentFileDecrypt(h.app.vault.getFileByPath("Plain.md")!);

		expect(Notice.messages().some((m) => m.includes("not encrypted"))).toBe(true);
		expect(h.disk("Plain.md")).toBe("hello\n");
	});
});

describe("file context menu (workspace 'file-menu')", () => {
	test("unknown status → both 'Encrypt with key pair' and 'Decrypt permanently'", async () => {
		h = await createPluginHarness({ files: { "Note.md": "hello\n" } });
		const menu = fileMenu(h.app.vault.getFileByPath("Note.md")!);
		expect(menu.titles__()).toEqual(["Encrypt with key pair", "Decrypt permanently"]);
	});

	test("encrypted note (read before) → only 'Decrypt permanently'", async () => {
		h = await createPluginHarness({ files: { "Encrypted.md": CIPHERTEXT_NOPASS } });
		const file = h.app.vault.getFileByPath("Encrypted.md")!;
		await h.app.vault.read(file);
		expect(fileMenu(file).titles__()).toEqual(["Decrypt permanently"]);
	});

	test("plaintext note (read before) → only 'Encrypt with key pair'", async () => {
		h = await createPluginHarness({ files: { "Plain.md": "hello\n" } });
		const file = h.app.vault.getFileByPath("Plain.md")!;
		await h.app.vault.read(file);
		expect(fileMenu(file).titles__()).toEqual(["Encrypt with key pair"]);
	});

	test("non-markdown file → no items from the plugin", async () => {
		h = await createPluginHarness({ files: { "img.png": "PNG" }, settings: { encryptAll: true } });
		expect(fileMenu(h.app.vault.getFileByPath("img.png")!).titles__()).toEqual([]);
	});

	test("clicking 'Encrypt with key pair' / 'Decrypt permanently' encrypts / decrypts the note on disk", async () => {
		h = await createPluginHarness({ files: { "Plain.md": "hello\n" } });
		const file = h.app.vault.getFileByPath("Plain.md")!;
		await h.app.vault.read(file);

		await fileMenu(file).item__("Encrypt with key pair")!.trigger__();
		await waitFor(() => isArmoredMessage(h!.disk("Plain.md")));
		expect(await decryptDisk(h, "Plain.md")).toBe("hello\n");
		expect(fileMenu(file).titles__()).toEqual(["Decrypt permanently"]);

		await fileMenu(file).item__("Decrypt permanently")!.trigger__();
		await waitFor(() => h!.disk("Plain.md") === "hello\n");
		expect(fileMenu(file).titles__()).toEqual(["Encrypt with key pair"]);
	});
});

describe("folder context menu + encryptAllFilesInPath", () => {
	const FILES = {
		"secret/a.md": "a\n",
		"secret/nested/b.md": "b\n",
		"secret/nested/deeper/c.md": "c\n",
		"other/d.md": "d\n",
	};
	const SECRET_FILES = ["secret/a.md", "secret/nested/b.md", "secret/nested/deeper/c.md"];

	test("a folder inside foldersToEncrypt (and its sub folders) offers 'Encrypt entire folder'; a folder outside does not", async () => {
		h = await createPluginHarness({ files: FILES, settings: { foldersToEncrypt: ["secret"] } });
		expect(fileMenu(h.app.vault.getFolderByPath("secret")!).titles__()).toEqual(["Encrypt entire folder"]);
		expect(fileMenu(h.app.vault.getFolderByPath("secret/nested")!).titles__()).toEqual(["Encrypt entire folder"]);
		expect(fileMenu(h.app.vault.getFolderByPath("other")!).titles__()).toEqual([]);
		expect(fileMenu(h.app.vault.getRoot()).titles__()).toEqual([]);
	});

	test("encryptAll=true offers 'Encrypt entire folder' for every folder", async () => {
		h = await createPluginHarness({ files: FILES, settings: { encryptAll: true } });
		expect(fileMenu(h.app.vault.getFolderByPath("secret")!).titles__()).toEqual(["Encrypt entire folder"]);
		expect(fileMenu(h.app.vault.getFolderByPath("other")!).titles__()).toEqual(["Encrypt entire folder"]);
	});

	test("default settings: no folder item at all", async () => {
		h = await createPluginHarness({ files: FILES });
		expect(fileMenu(h.app.vault.getFolderByPath("secret")!).titles__()).toEqual([]);
	});

	// F40: `FolderInSettingValidator` throwing *is* the "not in an encrypted folder" signal, and the catch at
	// main.ts:205-207 logs the ValidationError (with its stack) via a bare console.log — not DEBUG-gated, so
	// it fires in release builds too. With default settings foldersToEncrypt is empty, i.e. on every
	// right-click. Documents the noise; the stdout of this very file is full of it.
	test.fails("[F40] opening the folder menu outside foldersToEncrypt logs nothing to the console", async () => {
		h = await createPluginHarness({ files: FILES, settings: { foldersToEncrypt: ["secret"] } });
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			fileMenu(h.app.vault.getFolderByPath("other")!);
			expect(log).not.toHaveBeenCalled();
		} finally {
			log.mockRestore();
		}
	});

	test("clicking 'Encrypt entire folder' encrypts every note below the folder (recursively), nothing outside", async () => {
		h = await createPluginHarness({ files: FILES, settings: { foldersToEncrypt: ["secret"] } });
		const menu = fileMenu(h.app.vault.getFolderByPath("secret")!);

		await menu.item__("Encrypt entire folder")!.trigger__();
		// F12: the click handler does not await the (itself unawaited) work → poll
		await waitFor(() => SECRET_FILES.every((p) => isArmoredMessage(h!.disk(p))));

		for (const p of SECRET_FILES) expect(await decryptDisk(h, p)).toBe(FILES[p as keyof typeof FILES]);
		expect(h.disk("other/d.md")).toBe("d\n");
		expect(Notice.messages()).toEqual([]);
	});

	// F12: `children.forEach(async …)` and the recursive call are never awaited, so
	// the promise resolves before any file is encrypted and errors are swallowed inside persistentFileEncrypt.
	// Documents the current behaviour.
	test("[F12] encryptAllFilesInPath resolves before the files are encrypted (unawaited forEach)", async () => {
		h = await createPluginHarness({ files: FILES, settings: { foldersToEncrypt: ["secret"] } });

		await h.plugin.encryptAllFilesInPath(h.app.vault.getFolderByPath("secret")!);

		expect(SECRET_FILES.every((p) => isArmoredMessage(h!.disk(p)))).toBe(false);
		await waitFor(() => SECRET_FILES.every((p) => isArmoredMessage(h!.disk(p))));
	});

	// F30: unlike the file menu / commands (md|gpg only, main.ts:219,257,284)
	// `encryptAllFilesInPath` hands EVERY TFile below the folder to persistentFileEncrypt — attachments (read as
	// lossy UTF-8 text) and even .asc key files are overwritten with an OpenPGP message.
	test.fails("[F34] 'Encrypt entire folder' leaves non-markdown files (attachments, .asc keys) untouched", async () => {
		const png = "PNG binary-ish\n";
		const asc = "-----BEGIN PGP PUBLIC KEY BLOCK-----\nabc\n-----END PGP PUBLIC KEY BLOCK-----\n";
		h = await createPluginHarness({
			files: { "secret/a.md": "a\n", "secret/img.png": png, "secret/keys.asc": asc },
			settings: { foldersToEncrypt: ["secret"] },
		});
		await fileMenu(h.app.vault.getFolderByPath("secret")!).item__("Encrypt entire folder")!.trigger__();
		await waitFor(() => isArmoredMessage(h!.disk("secret/a.md")));
		await flush(50);

		expect(h.disk("secret/img.png")).toBe(png);
		expect(h.disk("secret/keys.asc")).toBe(asc);
	});

	test("already encrypted notes below the folder are left alone (Notice per note), the others are encrypted", async () => {
		h = await createPluginHarness({
			files: { "secret/Encrypted.md": CIPHERTEXT_NOPASS, "secret/Plain.md": "p\n" },
			settings: { foldersToEncrypt: ["secret"] },
		});
		await fileMenu(h.app.vault.getFolderByPath("secret")!).item__("Encrypt entire folder")!.trigger__();
		await waitFor(() => isArmoredMessage(h!.disk("secret/Plain.md")));
		await flush(20);

		expect(h.disk("secret/Encrypted.md")).toBe(CIPHERTEXT_NOPASS);
		expect(await decryptDisk(h, "secret/Plain.md")).toBe("p\n");
		expect(Notice.messages().filter((m) => m.includes("already encrypted"))).toHaveLength(1);
	});
});

describe("encryptedFileStatus lifecycle", () => {
	// F13: the status map is never invalidated on rename/delete. After renaming an
	// encrypted note away, a NEW note created at the old path is greeted with the "modified outside of
	// Obsidian" dialog. (encryptAll=true so that the write hook reaches that branch at all — with the default
	// settings F01 makes the folder validator throw first; a fixed plugin simply encrypts the new note.)
	test.fails("[F13] encryptedFileStatus is pruned on rename/delete", async () => {
		h = await createPluginHarness({ files: { "A.md": CIPHERTEXT_NOPASS }, settings: { encryptAll: true } });
		const a = h.app.vault.getFileByPath("A.md")!;
		await h.app.vault.read(a); // status A.md → encrypted
		await h.app.fileManager.renameFile(a, "B.md");
		expect(h.disk("A.md")).toBeUndefined();

		const create = h.app.vault.create("A.md", "brand new\n");
		await flush();
		const dialog = Modal.opened__.find((m) => m instanceof DialogModal) as DialogModal | undefined;
		try {
			expect(dialog).toBeUndefined();
			await create;
			expect(isArmoredMessage(h.disk("A.md"))).toBe(true);
			expect(await decryptDisk(h, "A.md")).toBe("brand new\n");
		} finally {
			if (dialog?.isOpen__) {
				Array.from(dialog.contentEl.querySelectorAll("button")).find((b) => b.textContent === "No")!.click();
				await create;
			}
		}
	});

	test("after renaming an encrypted note the new path has no status yet (both menu items) — F13 symptom (#52)", async () => {
		h = await createPluginHarness({ files: { "A.md": CIPHERTEXT_NOPASS } });
		const a = h.app.vault.getFileByPath("A.md")!;
		await h.app.vault.read(a);
		expect(fileMenu(a).titles__()).toEqual(["Decrypt permanently"]);

		await h.app.fileManager.renameFile(a, "B.md");
		expect(fileMenu(a).titles__()).toEqual(["Encrypt with key pair", "Decrypt permanently"]);
	});
});
