/**
 * Behavioural fakes of the Obsidian `App` surface that gpgCrypt touches at runtime:
 * an in-memory DataAdapter, a Vault whose read/modify go THROUGH the adapter (so the plugin's
 * adapter hooks apply exactly as in Obsidian), a Workspace with layout-ready + active-file control,
 * a FileManager, and the undocumented internals the plugin patches
 * (`app.internalPlugins.plugins["file-recovery"].instance`, `app.setting`).
 *
 * Only used by tests; imports `vi` for spies.
 */
import { vi } from "vitest";
import {
	App,
	MarkdownView,
	TAbstractFile,
	TFile,
	TFolder,
	Vault,
	Workspace,
	WorkspaceLeaf,
	normalizePath,
	type DataWriteOptions,
} from "obsidian";

 

export class FakeAdapter {
	/** on-disk content, keyed by normalized path (bypasses every hook) */
	files = new Map<string, string>();
	folders = new Set<string>();
	/** every write that reached the "disk", oldest first */
	writes: { path: string; data: string }[] = [];

	// Own-property functions (not prototype methods) so that the plugin can overwrite them on the
	// instance exactly as it does with the real adapter, and `onunload` can restore them.
	read: (normalizedPath: string) => Promise<string>;
	readBinary: (normalizedPath: string) => Promise<ArrayBuffer>;
	write: (normalizedPath: string, data: string, options?: DataWriteOptions) => Promise<void>;
	writeBinary: (normalizedPath: string, data: ArrayBuffer, options?: DataWriteOptions) => Promise<void>;
	append: (normalizedPath: string, data: string, options?: DataWriteOptions) => Promise<void>;
	process: (normalizedPath: string, fn: (data: string) => string, options?: DataWriteOptions) => Promise<string>;
	exists: (normalizedPath: string) => Promise<boolean>;
	remove: (normalizedPath: string) => Promise<void>;
	rename: (normalizedPath: string, normalizedNewPath: string) => Promise<void>;
	getResourcePath: (normalizedPath: string) => string;
	getName: () => string;
	getBasePath: () => string;

	constructor() {
		this.read = async (p) => {
			const key = normalizePath(p);
			if (!this.files.has(key)) throw new Error(`ENOENT: no such file, open '${p}'`);
			return this.files.get(key)!;
		};
		this.readBinary = async (p) => {
			const text = await this.read(p);
			return new TextEncoder().encode(text).buffer as ArrayBuffer;
		};
		this.write = async (p, data) => {
			const key = normalizePath(p);
			this.files.set(key, data);
			this.writes.push({ path: key, data });
		};
		this.writeBinary = async (p, data) => {
			await this.write(p, new TextDecoder().decode(new Uint8Array(data)));
		};
		this.append = async (p, data) => {
			const key = normalizePath(p);
			await this.write(key, (this.files.get(key) ?? "") + data);
		};
		this.process = async (p, fn) => {
			const key = normalizePath(p);
			const current = this.files.get(key) ?? "";
			const next = fn(current);
			await this.write(key, next);
			return next;
		};
		this.exists = async (p) => {
			const key = normalizePath(p);
			return this.files.has(key) || this.folders.has(key);
		};
		this.remove = async (p) => {
			this.files.delete(normalizePath(p));
		};
		this.rename = async (from, to) => {
			const a = normalizePath(from);
			const b = normalizePath(to);
			if (!this.files.has(a)) throw new Error(`ENOENT: rename '${from}'`);
			this.files.set(b, this.files.get(a)!);
			this.files.delete(a);
		};
		this.getResourcePath = (p) => `app://local/${normalizePath(p)}`;
		this.getName = () => "test-vault";
		this.getBasePath = () => "/tmp/test-vault";
	}
}

export class FakeVault extends Vault {
	adapter: FakeAdapter;
	private tfiles = new Map<string, TFile>();
	private tfolders = new Map<string, TFolder>();

	constructor() {
		super();
		this.adapter = new FakeAdapter();
		const root = new TFolder("", this);
		this.tfolders.set("", root);
	}

	// ---- tree management --------------------------------------------------------------------------
	private ensureFolder(path: string): TFolder {
		const key = normalizePath(path) === "/" ? "" : normalizePath(path);
		let folder = this.tfolders.get(key);
		if (folder) return folder;
		folder = new TFolder(key, this);
		const parentPath = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
		const parent = this.ensureFolder(parentPath);
		folder.parent = parent;
		parent.children.push(folder);
		this.tfolders.set(key, folder);
		this.adapter.folders.add(key);
		return folder;
	}

	/** Creates a TFile entry (and its parent folders) for a path; content must already be on the adapter. */
	indexFile__(path: string): TFile {
		const key = normalizePath(path);
		let file = this.tfiles.get(key);
		if (file) return file;
		file = new TFile(key, this);
		const parentPath = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
		const parent = this.ensureFolder(parentPath);
		file.parent = parent;
		parent.children.push(file);
		this.tfiles.set(key, file);
		return file;
	}

	/** Seed files directly on "disk" and in the vault index (bypasses hooks). */
	seed__(files: Record<string, string>): void {
		for (const [path, content] of Object.entries(files)) {
			this.adapter.files.set(normalizePath(path), content);
			this.indexFile__(path);
		}
	}

	/** Seed empty folders (e.g. for FolderValidator). */
	seedFolders__(folders: string[]): void {
		for (const f of folders) this.ensureFolder(f);
	}

	private unindex(file: TFile): void {
		this.tfiles.delete(file.path);
		if (file.parent) file.parent.children = file.parent.children.filter((c) => c !== file);
	}

	// ---- Obsidian Vault API ---------------------------------------------------------------------
	getAbstractFileByPath(path: string): TAbstractFile | null {
		const key = normalizePath(path);
		if (key === "/") return this.tfolders.get("") ?? null;
		return this.tfiles.get(key) ?? this.tfolders.get(key) ?? null;
	}
	getFileByPath(path: string): TFile | null {
		return this.tfiles.get(normalizePath(path)) ?? null;
	}
	getFolderByPath(path: string): TFolder | null {
		const key = normalizePath(path);
		return this.tfolders.get(key === "/" ? "" : key) ?? null;
	}
	getRoot(): TFolder {
		return this.tfolders.get("")!;
	}
	getFiles(): TFile[] {
		return [...this.tfiles.values()];
	}
	getMarkdownFiles(): TFile[] {
		return this.getFiles().filter((f) => f.extension === "md");
	}
	getAllLoadedFiles(): TAbstractFile[] {
		return [...this.tfolders.values(), ...this.tfiles.values()];
	}

	// Reads/writes go through the (possibly hooked) adapter methods, looked up at call time.
	async read(file: TFile): Promise<string> {
		return this.adapter.read(file.path);
	}
	async cachedRead(file: TFile): Promise<string> {
		return this.adapter.read(file.path);
	}
	async readBinary(file: TFile): Promise<ArrayBuffer> {
		return this.adapter.readBinary(file.path);
	}
	async modify(file: TFile, data: string, options?: DataWriteOptions): Promise<void> {
		await this.adapter.write(file.path, data, options);
		this.trigger("modify", file);
	}
	async append(file: TFile, data: string, options?: DataWriteOptions): Promise<void> {
		await this.adapter.append(file.path, data, options);
		this.trigger("modify", file);
	}
	async process(file: TFile, fn: (data: string) => string, options?: DataWriteOptions): Promise<string> {
		const result = await this.adapter.process(file.path, fn, options);
		this.trigger("modify", file);
		return result;
	}
	async create(path: string, data: string, options?: DataWriteOptions): Promise<TFile> {
		await this.adapter.write(path, data, options);
		const file = this.indexFile__(path);
		this.trigger("create", file);
		return file;
	}
	async createFolder(path: string): Promise<TFolder> {
		return this.ensureFolder(path);
	}
	async delete(file: TAbstractFile, _force?: boolean): Promise<void> {
		if (file instanceof TFile) {
			await this.adapter.remove(file.path);
			this.unindex(file);
		}
		this.trigger("delete", file);
	}
	async trash(file: TAbstractFile, _system?: boolean): Promise<void> {
		return this.delete(file);
	}
	async rename(file: TAbstractFile, newPath: string): Promise<void> {
		if (!(file instanceof TFile)) throw new Error("FakeVault.rename: folders not supported");
		const oldPath = file.path;
		await this.adapter.rename(oldPath, newPath);
		this.unindex(file);
		file.setPath__(normalizePath(newPath));
		const parentPath = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
		const parent = this.ensureFolder(parentPath);
		file.parent = parent;
		parent.children.push(file);
		this.tfiles.set(file.path, file);
		this.trigger("rename", file, oldPath);
	}
}

export class FakeWorkspace extends Workspace {
	layoutReady = false;
	private layoutReadyCallbacks: (() => any)[] = [];
	private activeFile: TFile | null = null;
	activeView: MarkdownView | null = null;

	onLayoutReady(callback: () => any): void {
		if (this.layoutReady) void callback();
		else this.layoutReadyCallbacks.push(callback);
	}
	/** test helper: run (and await) every queued onLayoutReady callback */
	async setLayoutReady__(): Promise<void> {
		this.layoutReady = true;
		const cbs = this.layoutReadyCallbacks;
		this.layoutReadyCallbacks = [];
		for (const cb of cbs) await cb();
	}
	getActiveFile(): TFile | null {
		return this.activeFile;
	}
	/** test helper: set the active file and fire "file-open" like Obsidian */
	setActiveFile__(file: TFile | null, opts: { view?: boolean } = { view: true }): void {
		this.activeFile = file;
		if (opts.view !== false) {
			const view = new MarkdownView();
			view.file = file;
			this.activeView = file ? view : null;
		}
		this.trigger("file-open", file);
	}
	getActiveViewOfType<T>(type: new (...args: any[]) => T): T | null {
		return this.activeView instanceof type ? (this.activeView as unknown as T) : null;
	}
	getLeavesOfType(_type: string): WorkspaceLeaf[] {
		return [];
	}
	iterateAllLeaves(_cb: (leaf: WorkspaceLeaf) => any): void {}
	detachLeavesOfType(_type: string): void {}
}

export class FakeFileManager {
	constructor(private vault: FakeVault) {}
	async renameFile(file: TAbstractFile, newPath: string): Promise<void> {
		await this.vault.rename(file, newPath);
	}
	async trashFile(file: TAbstractFile): Promise<void> {
		await this.vault.delete(file);
	}
	async processFrontMatter(_file: TFile, _fn: (fm: any) => void): Promise<void> {}
	generateMarkdownLink(file: TFile): string {
		return `[[${file.basename}]]`;
	}
}

/**
 * Stand-in for the core "File recovery" plugin instance. Obsidian registers its `onFileChanged`
 * as a vault "modify" and workspace "file-open" listener; when a file changes it snapshots the
 * content via `vault.cachedRead()` — which is why gpgCrypt hooks `cachedRead` (main.ts:540-595).
 */
export class FakeFileRecoveryInstance {
	snapshots: { path: string; content: string }[] = [];
	onFileChanged: (file: TFile | null) => Promise<unknown>;
	forceAdd: (normalizedPath: string, data: string) => Promise<unknown>;

	constructor(private app: FakeApp) {
		this.onFileChanged = vi.fn(async (file: TFile | null) => {
			if (!file || !(file instanceof TFile)) return null;
			const content = await this.app.vault.cachedRead(file);
			this.snapshots.push({ path: file.path, content });
			return content;
		});
		this.forceAdd = vi.fn(async (normalizedPath: string, data: string) => {
			this.snapshots.push({ path: normalizedPath, content: data });
			return null;
		});
	}
}

export interface FakeAppOptions {
	/** Model the "File recovery" core plugin being disabled/absent (F03). */
	withoutFileRecovery?: boolean;
}

export class FakeApp extends App {
	vault: FakeVault;
	workspace: FakeWorkspace;
	fileManager: FakeFileManager;
	internalPlugins: {
		plugins: Record<string, { enabled: boolean; instance: any } | undefined>;
		getPluginById(id: string): { enabled: boolean; instance: any } | undefined;
	};
	setting: { open: ReturnType<typeof vi.fn>; openTabById: ReturnType<typeof vi.fn>; pluginTabs: unknown[] };
	fileRecovery: FakeFileRecoveryInstance | null = null;
	plugins = { plugins: {} as Record<string, unknown>, enabledPlugins: new Set<string>() };

	constructor(options: FakeAppOptions = {}) {
		super();
		this.vault = new FakeVault();
		this.workspace = new FakeWorkspace();
		this.fileManager = new FakeFileManager(this.vault);
		this.internalPlugins = {
			plugins: {},
			getPluginById: (id: string) => this.internalPlugins.plugins[id],
		};
		this.setting = { open: vi.fn(), openTabById: vi.fn(), pluginTabs: [] };

		if (!options.withoutFileRecovery) {
			this.fileRecovery = new FakeFileRecoveryInstance(this);
			this.internalPlugins.plugins["file-recovery"] = { enabled: true, instance: this.fileRecovery };
			// Mirror Obsidian's registrations that gpgCrypt un-/re-registers by function identity.
			this.vault.on("modify", this.fileRecovery.onFileChanged);
			this.workspace.on("file-open", this.fileRecovery.onFileChanged);
		}
	}
}

/** Convenience: an App with pre-seeded files/folders. */
export function createFakeApp(seed: { files?: Record<string, string>; folders?: string[] } = {}, options: FakeAppOptions = {}): FakeApp {
	const app = new FakeApp(options);
	if (seed.folders) app.vault.seedFolders__(seed.folders);
	if (seed.files) app.vault.seed__(seed.files);
	return app;
}
