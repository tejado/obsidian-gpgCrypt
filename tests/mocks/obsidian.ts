/**
 * Hand-rolled runtime mock of the `obsidian` module for Vitest.
 *
 * The real `obsidian` npm package is types-only (it has no JavaScript); the API only exists inside the
 * running app. `vitest.config.ts` aliases `obsidian` to this file, so `import { Modal } from "obsidian"`
 * in `src/**` resolves here at test time. Only the surface used by gpgCrypt (plus small conveniences) is
 * implemented; DOM helper methods (`createEl`, `empty`, `addClass`, …) live in `tests/setup/dom.ts`.
 *
 * Test-only members are suffixed with `__` (or exported as `__…`) so they cannot be confused with real API.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------------------------------
// constants / free functions
// ---------------------------------------------------------------------------------------------------

export const apiVersion = "1.12.3";

export function requireApiVersion(version: string): boolean {
	const [a, b, c] = apiVersion.split(".").map(Number);
	const [x, y, z] = version.split(".").map((n) => Number(n) || 0);
	return a > x || (a === x && (b > y || (b === y && c >= z)));
}

/** Mirrors Obsidian's normalizePath: `\` → `/`, collapse `//`, strip leading/trailing `/`, NFC. */
export function normalizePath(path: string): string {
	const normalized = path
		.replace(/([\\/])+/g, "/")
		.replace(/(^\/+|\/+$)/g, "")
		.normalize("NFC");
	return normalized === "" ? "/" : normalized;
}

/** Obsidian empties the element and inserts an `<svg class="svg-icon lucide-<id>">`. */
export function setIcon(parent: HTMLElement, iconId: string): void {
	while (parent.firstChild) parent.removeChild(parent.firstChild);
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("class", `svg-icon lucide-${iconId}`);
	parent.appendChild(svg);
}

export function setTooltip(el: HTMLElement, tooltip: string): void {
	el.setAttribute("aria-label", tooltip);
}

export function debounce<T extends unknown[]>(cb: (...args: T) => unknown, _timeout?: number, _resetTimer?: boolean) {
	const fn = ((...args: T) => {
		cb(...args);
		return fn;
	}) as ((...args: T) => typeof fn) & { cancel: () => typeof fn; run: () => unknown };
	fn.cancel = () => fn;
	fn.run = () => cb(...([] as unknown as T));
	return fn;
}

export const Platform = {
	isDesktop: true,
	isMobile: false,
	isDesktopApp: true,
	isMobileApp: false,
	isIosApp: false,
	isAndroidApp: false,
	isPhone: false,
	isTablet: false,
	isMacOS: false,
	isWin: false,
	isLinux: true,
	isSafari: false,
	resourcePathPrefix: "app://local/",
};
const PLATFORM_DEFAULTS = { ...Platform };

// ---------------------------------------------------------------------------------------------------
// Events / files / vault / workspace / app
// ---------------------------------------------------------------------------------------------------

export interface EventRef {
	name: string;
	callback: (...data: any[]) => any;
	ctx?: unknown;
}

export class Events {
	private handlers__ = new Map<string, EventRef[]>();

	on(name: string, callback: (...data: any[]) => any, ctx?: unknown): EventRef {
		const ref: EventRef = { name, callback, ctx };
		const list = this.handlers__.get(name) ?? [];
		list.push(ref);
		this.handlers__.set(name, list);
		return ref;
	}

	/** Removes every handler registered with this callback function (identity), like Obsidian. */
	off(name: string, callback: (...data: any[]) => any): void {
		const list = this.handlers__.get(name);
		if (!list) return;
		this.handlers__.set(
			name,
			list.filter((ref) => ref.callback !== callback),
		);
	}

	offref(ref: EventRef): void {
		const list = this.handlers__.get(ref.name);
		if (!list) return;
		this.handlers__.set(
			ref.name,
			list.filter((r) => r !== ref),
		);
	}

	trigger(name: string, ...data: any[]): void {
		for (const ref of [...(this.handlers__.get(name) ?? [])]) {
			ref.callback.apply(ref.ctx, data);
		}
	}

	tryTrigger(evt: EventRef, args: any[]): void {
		evt.callback.apply(evt.ctx, args);
	}

	/** test helper: registered callbacks for an event name */
	listeners__(name: string): ((...data: any[]) => any)[] {
		return (this.handlers__.get(name) ?? []).map((r) => r.callback);
	}
}

export abstract class TAbstractFile {
	vault!: Vault;
	path = "";
	name = "";
	parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
	basename = "";
	extension = "";
	stat = { ctime: 0, mtime: 0, size: 0 };

	constructor(path = "", vault?: Vault) {
		super();
		this.setPath__(path);
		if (vault) this.vault = vault;
	}

	setPath__(path: string): void {
		this.path = path;
		this.name = path.split("/").pop() ?? path;
		const dot = this.name.lastIndexOf(".");
		this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
		this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
	}
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];

	constructor(path = "", vault?: Vault) {
		super();
		this.path = path;
		this.name = path.split("/").pop() ?? path;
		if (vault) this.vault = vault;
	}

	isRoot(): boolean {
		return this.path === "" || this.path === "/";
	}
}

export interface DataWriteOptions {
	ctime?: number;
	mtime?: number;
}

/**
 * Minimal base classes with the METHOD SIGNATURES the plugin sources use (so `src/**` type-checks
 * against the mock); the behavioural implementations live in tests/mocks/fake-app.ts (FakeVault etc.).
 * The base implementations throw to make accidental use obvious.
 */
const notImplemented = (what: string) => {
	throw new Error(`${what} is not implemented in the base obsidian mock — use createFakeApp() from tests/mocks/fake-app.ts`);
};

export class Vault extends Events {
	adapter: any = {};
	configDir = ".obsidian";
	getName(): string {
		return "test-vault";
	}
	getAbstractFileByPath(_path: string): TAbstractFile | null {
		return notImplemented("Vault.getAbstractFileByPath");
	}
	getFileByPath(_path: string): TFile | null {
		return notImplemented("Vault.getFileByPath");
	}
	getFolderByPath(_path: string): TFolder | null {
		return notImplemented("Vault.getFolderByPath");
	}
	getRoot(): TFolder {
		return notImplemented("Vault.getRoot");
	}
	getFiles(): TFile[] {
		return [];
	}
	getMarkdownFiles(): TFile[] {
		return [];
	}
	getAllLoadedFiles(): TAbstractFile[] {
		return [];
	}
	async read(_file: TFile): Promise<string> {
		return notImplemented("Vault.read");
	}
	async cachedRead(_file: TFile): Promise<string> {
		return notImplemented("Vault.cachedRead");
	}
	async readBinary(_file: TFile): Promise<ArrayBuffer> {
		return notImplemented("Vault.readBinary");
	}
	async modify(_file: TFile, _data: string, _options?: DataWriteOptions): Promise<void> {
		return notImplemented("Vault.modify");
	}
	async append(_file: TFile, _data: string, _options?: DataWriteOptions): Promise<void> {
		return notImplemented("Vault.append");
	}
	async process(_file: TFile, _fn: (data: string) => string, _options?: DataWriteOptions): Promise<string> {
		return notImplemented("Vault.process");
	}
	async create(_path: string, _data: string, _options?: DataWriteOptions): Promise<TFile> {
		return notImplemented("Vault.create");
	}
	async createFolder(_path: string): Promise<TFolder> {
		return notImplemented("Vault.createFolder");
	}
	async delete(_file: TAbstractFile, _force?: boolean): Promise<void> {
		return notImplemented("Vault.delete");
	}
	async trash(_file: TAbstractFile, _system?: boolean): Promise<void> {
		return notImplemented("Vault.trash");
	}
	async rename(_file: TAbstractFile, _newPath: string): Promise<void> {
		return notImplemented("Vault.rename");
	}
	// typed overloads for the events the plugin uses
	on(name: "create" | "modify" | "delete", callback: (file: TAbstractFile) => any, ctx?: unknown): EventRef;
	on(name: "rename", callback: (file: TAbstractFile, oldPath: string) => any, ctx?: unknown): EventRef;
	on(name: string, callback: (...data: any[]) => any, ctx?: unknown): EventRef;
	on(name: string, callback: (...data: any[]) => any, ctx?: unknown): EventRef {
		return super.on(name, callback, ctx);
	}
}

export class Workspace extends Events {
	onLayoutReady(_callback: () => any): void {
		return notImplemented("Workspace.onLayoutReady");
	}
	getActiveFile(): TFile | null {
		return null;
	}
	getActiveViewOfType<T>(_type: new (...args: any[]) => T): T | null {
		return null;
	}
	getLeavesOfType(_viewType: string): WorkspaceLeaf[] {
		return [];
	}
	iterateAllLeaves(_callback: (leaf: WorkspaceLeaf) => any): void {}
	detachLeavesOfType(_viewType: string): void {}
	on(name: "file-menu", callback: (menu: Menu, file: TAbstractFile, source: string, leaf?: WorkspaceLeaf) => any, ctx?: unknown): EventRef;
	on(name: "file-open", callback: (file: TFile | null) => any, ctx?: unknown): EventRef;
	on(name: string, callback: (...data: any[]) => any, ctx?: unknown): EventRef;
	on(name: string, callback: (...data: any[]) => any, ctx?: unknown): EventRef {
		return super.on(name, callback, ctx);
	}
}

export class FileManager {
	async renameFile(_file: TAbstractFile, _newPath: string): Promise<void> {
		return notImplemented("FileManager.renameFile");
	}
	async trashFile(_file: TAbstractFile): Promise<void> {
		return notImplemented("FileManager.trashFile");
	}
	async processFrontMatter(_file: TFile, _fn: (frontmatter: any) => void, _options?: DataWriteOptions): Promise<void> {
		return notImplemented("FileManager.processFrontMatter");
	}
	generateMarkdownLink(_file: TFile, _sourcePath: string, _subpath?: string, _alias?: string): string {
		return "";
	}
}

export class MetadataCache extends Events {}

export class Scope {
	register(_modifiers: unknown, _key: unknown, _func: unknown) {
		return {};
	}
	unregister(_handler: unknown) {}
}

export class App {
	vault: Vault = new Vault();
	workspace: Workspace = new Workspace();
	fileManager: FileManager = new FileManager();
	metadataCache: MetadataCache = new MetadataCache();
	keymap = {};
	scope = new Scope();
	lastEvent: UIEvent | null = null;
}

// ---------------------------------------------------------------------------------------------------
// Component / Plugin
// ---------------------------------------------------------------------------------------------------

export class Component {
	private children__: Component[] = [];
	private events__: EventRef[] = [];
	intervals__: number[] = [];
	loaded__ = false;

	load(): void {
		this.loaded__ = true;
		this.onload();
	}
	onload(): void {}
	unload(): void {
		this.loaded__ = false;
		for (const id of this.intervals__) clearInterval(id);
		this.intervals__ = [];
		this.onunload();
	}
	onunload(): void {}
	addChild<T extends Component>(component: T): T {
		this.children__.push(component);
		component.load();
		return component;
	}
	removeChild<T extends Component>(component: T): T {
		this.children__ = this.children__.filter((c) => c !== component);
		component.unload();
		return component;
	}
	register(_cb: () => any): void {}
	registerEvent(eventRef: EventRef): void {
		this.events__.push(eventRef);
	}
	registerDomEvent(el: EventTarget, type: string, callback: (...args: any[]) => any): void {
		el.addEventListener(type, callback);
	}
	registerInterval(id: number): number {
		this.intervals__.push(id);
		return id;
	}
}

export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	minAppVersion: string;
	description: string;
	author: string;
	authorUrl?: string;
	isDesktopOnly?: boolean;
	dir?: string;
}

export interface Command {
	id: string;
	name: string;
	callback?: () => any;
	checkCallback?: (checking: boolean) => boolean | void;
	icon?: string;
	hotkeys?: unknown[];
}

export class Plugin extends Component {
	app: App;
	manifest: PluginManifest;

	/** In-memory `data.json` (returned by loadData, written by saveData). */
	__data: unknown = null;
	/** Registered commands by id (`addCommand`). */
	commands__: Record<string, Command> = {};
	settingTabs__: PluginSettingTab[] = [];
	statusBarItems__: HTMLElement[] = [];
	extensions__: { extensions: string[]; viewType: string }[] = [];
	ribbonIcons__: HTMLElement[] = [];

	constructor(app: App, manifest: PluginManifest) {
		super();
		this.app = app;
		this.manifest = manifest;
	}

	addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement {
		const el = document.createElement("div");
		el.className = "side-dock-ribbon-action";
		el.setAttribute("aria-label", title);
		setIcon(el, icon);
		el.addEventListener("click", callback);
		this.ribbonIcons__.push(el);
		return el;
	}

	addStatusBarItem(): HTMLElement {
		let bar = document.querySelector<HTMLElement>(".status-bar");
		if (!bar) {
			bar = document.createElement("div");
			bar.className = "status-bar";
			document.body.appendChild(bar);
		}
		const item = document.createElement("div");
		item.className = `status-bar-item plugin-${this.manifest.id}`;
		bar.appendChild(item);
		this.statusBarItems__.push(item);
		return item;
	}

	addCommand(command: Command): Command {
		const id = command.id.includes(":") ? command.id : `${this.manifest.id}:${command.id}`;
		this.commands__[id] = command;
		return command;
	}

	addSettingTab(settingTab: PluginSettingTab): void {
		this.settingTabs__.push(settingTab);
	}

	registerView(_type: string, _viewCreator: unknown): void {}

	registerExtensions(extensions: string[], viewType: string): void {
		this.extensions__.push({ extensions, viewType });
	}

	registerMarkdownPostProcessor(_p: unknown): void {}
	registerMarkdownCodeBlockProcessor(_lang: string, _handler: unknown): void {}
	registerEditorExtension(_extension: unknown): void {}
	registerObsidianProtocolHandler(_action: string, _handler: unknown): void {}
	registerEditorSuggest(_s: unknown): void {}
	registerHoverLinkSource(_id: string, _info: unknown): void {}

	async loadData(): Promise<any> {
		return this.__data === null || this.__data === undefined ? null : structuredClone(this.__data);
	}

	async saveData(data: any): Promise<void> {
		this.__data = structuredClone(data);
	}

	onUserEnable(): void {}
	onExternalSettingsChange?(): any;
}

// ---------------------------------------------------------------------------------------------------
// UI: Notice, Modal, PluginSettingTab, Setting + components, Menu, views
// ---------------------------------------------------------------------------------------------------

export class Notice {
	/** test helper: every Notice created since the last reset, oldest first */
	static log: Notice[] = [];
	static messages(): string[] {
		return Notice.log.map((n) => n.messageText());
	}
	static reset(): void {
		Notice.log = [];
	}

	noticeEl: HTMLElement;
	message: string | DocumentFragment | unknown;
	duration: number | undefined;
	hidden = false;

	constructor(message: string | DocumentFragment | unknown, duration?: number) {
		this.message = message;
		this.duration = duration;
		this.noticeEl = document.createElement("div");
		this.noticeEl.className = "notice";
		this.noticeEl.textContent = this.messageText();
		Notice.log.push(this);
	}

	messageText(): string {
		if (typeof this.message === "string") return this.message;
		if (this.message instanceof DocumentFragment) return this.message.textContent ?? "";
		return String(this.message);
	}

	setMessage(message: string | DocumentFragment): this {
		this.message = message;
		this.noticeEl.textContent = this.messageText();
		return this;
	}

	hide(): void {
		this.hidden = true;
	}
}

export class Modal {
	app: App;
	scope = new Scope();
	containerEl: HTMLElement;
	modalEl: HTMLElement;
	titleEl: HTMLElement;
	contentEl: HTMLElement;
	shouldRestoreSelection = true;
	/** test helper */
	isOpen__ = false;

	/** test helper: modals opened since the last reset (oldest first) */
	static opened__: Modal[] = [];

	constructor(app: App) {
		this.app = app;
		// Same skeleton as Obsidian: .modal-container > .modal-bg + .modal > (.modal-close-button, .modal-header > .modal-title, .modal-content)
		this.containerEl = document.createElement("div");
		this.containerEl.className = "modal-container mod-dim";
		const bg = document.createElement("div");
		bg.className = "modal-bg";
		bg.addEventListener("click", () => this.close());
		this.containerEl.appendChild(bg);
		this.modalEl = document.createElement("div");
		this.modalEl.className = "modal";
		this.containerEl.appendChild(this.modalEl);
		const closeBtn = document.createElement("div");
		closeBtn.className = "modal-close-button";
		closeBtn.addEventListener("click", () => this.close());
		this.modalEl.appendChild(closeBtn);
		const header = document.createElement("div");
		header.className = "modal-header";
		this.modalEl.appendChild(header);
		this.titleEl = document.createElement("div");
		this.titleEl.className = "modal-title";
		header.appendChild(this.titleEl);
		this.contentEl = document.createElement("div");
		this.contentEl.className = "modal-content";
		this.modalEl.appendChild(this.contentEl);
	}

	open(): void {
		this.isOpen__ = true;
		Modal.opened__.push(this);
		document.body.appendChild(this.containerEl);
		this.onOpen();
	}

	close(): void {
		if (!this.isOpen__) {
			// Obsidian tolerates close() on a modal that is not open; subclasses call it from close() overrides.
			this.onClose();
			return;
		}
		this.isOpen__ = false;
		this.onClose();
		this.containerEl.remove();
	}

	onOpen(): void {}
	onClose(): void {}

	setTitle(title: string): this {
		this.titleEl.textContent = title;
		return this;
	}

	setContent(content: string | DocumentFragment): this {
		if (typeof content === "string") this.contentEl.textContent = content;
		else {
			this.contentEl.textContent = "";
			this.contentEl.appendChild(content);
		}
		return this;
	}
}

export abstract class SettingTab {
	app: App;
	containerEl: HTMLElement;
	constructor(app: App) {
		this.app = app;
		this.containerEl = document.createElement("div");
		this.containerEl.className = "vertical-tab-content";
	}
	abstract display(): void;
	hide(): void {}
}

export abstract class PluginSettingTab extends SettingTab {
	plugin: Plugin;
	constructor(app: App, plugin: Plugin) {
		super(app);
		this.plugin = plugin;
	}
}

export abstract class BaseComponent {
	disabled = false;
	then(cb: (component: this) => any): this {
		cb(this);
		return this;
	}
	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		return this;
	}
}

export abstract class ValueComponent<T> extends BaseComponent {
	registerOptionListener(_listeners: Record<string, (value?: T) => T>, _key: string): this {
		return this;
	}
	abstract getValue(): T;
	abstract setValue(value: T): this;
}

export class TextComponent extends ValueComponent<string> {
	inputEl: HTMLInputElement;
	private changeCallback__: ((value: string) => any) | null = null;

	constructor(containerEl: HTMLElement) {
		super();
		this.inputEl = document.createElement("input");
		this.inputEl.type = "text";
		containerEl.appendChild(this.inputEl);
		// Obsidian listens to "input" for text components (and to "change" for setValue-less flows)
		this.inputEl.addEventListener("input", () => this.changeCallback__?.(this.inputEl.value));
	}
	getValue(): string {
		return this.inputEl.value;
	}
	/** Programmatic setValue does NOT fire onChange (matches Obsidian). */
	setValue(value: string): this {
		this.inputEl.value = value;
		return this;
	}
	setPlaceholder(placeholder: string): this {
		this.inputEl.placeholder = placeholder;
		return this;
	}
	setDisabled(disabled: boolean): this {
		super.setDisabled(disabled);
		this.inputEl.disabled = disabled;
		return this;
	}
	onChange(callback: (value: string) => any): this {
		this.changeCallback__ = callback;
		return this;
	}
	onChanged(): void {
		this.changeCallback__?.(this.inputEl.value);
	}
	/** test helper: type a value as the user would (fires onChange). */
	simulateChange__(value: string): void {
		this.inputEl.value = value;
		this.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
	}
}

export class TextAreaComponent extends TextComponent {}
export class SearchComponent extends TextComponent {}
export class MomentFormatComponent extends TextComponent {}

export class ToggleComponent extends ValueComponent<boolean> {
	toggleEl: HTMLElement;
	private changeCallback__: ((value: boolean) => any) | null = null;

	constructor(containerEl: HTMLElement) {
		super();
		this.toggleEl = document.createElement("div");
		this.toggleEl.className = "checkbox-container";
		const input = document.createElement("input");
		input.type = "checkbox";
		this.toggleEl.appendChild(input);
		containerEl.appendChild(this.toggleEl);
		this.toggleEl.addEventListener("click", () => {
			if (this.disabled) return;
			this.setValue(!this.getValue());
			this.onChanged();
		});
	}
	getValue(): boolean {
		return this.toggleEl.classList.contains("is-enabled");
	}
	setValue(on: boolean): this {
		this.toggleEl.classList.toggle("is-enabled", on);
		(this.toggleEl.querySelector("input") as HTMLInputElement).checked = on;
		return this;
	}
	setTooltip(tooltip: string): this {
		this.toggleEl.setAttribute("aria-label", tooltip);
		return this;
	}
	setDisabled(disabled: boolean): this {
		super.setDisabled(disabled);
		this.toggleEl.classList.toggle("is-disabled", disabled);
		return this;
	}
	onClick(): void {
		this.toggleEl.click();
	}
	onChange(callback: (value: boolean) => any): this {
		this.changeCallback__ = callback;
		return this;
	}
	onChanged(): void {
		this.changeCallback__?.(this.getValue());
	}
	/** test helper: click the toggle (fires onChange). */
	simulateClick__(): void {
		this.toggleEl.click();
	}
}

export class DropdownComponent extends ValueComponent<string> {
	selectEl: HTMLSelectElement;
	private changeCallback__: ((value: string) => any) | null = null;

	constructor(containerEl: HTMLElement) {
		super();
		this.selectEl = document.createElement("select");
		this.selectEl.className = "dropdown";
		containerEl.appendChild(this.selectEl);
		this.selectEl.addEventListener("change", () => this.changeCallback__?.(this.selectEl.value));
	}
	addOption(value: string, display: string): this {
		const option = document.createElement("option");
		option.value = value;
		option.textContent = display;
		this.selectEl.appendChild(option);
		return this;
	}
	addOptions(options: Record<string, string>): this {
		for (const [value, display] of Object.entries(options)) this.addOption(value, display);
		return this;
	}
	getValue(): string {
		return this.selectEl.value;
	}
	setValue(value: string): this {
		this.selectEl.value = value;
		return this;
	}
	setDisabled(disabled: boolean): this {
		super.setDisabled(disabled);
		this.selectEl.disabled = disabled;
		return this;
	}
	onChange(callback: (value: string) => any): this {
		this.changeCallback__ = callback;
		return this;
	}
	/** test helper: select a value as the user would (fires onChange). */
	simulateChange__(value: string): void {
		this.selectEl.value = value;
		this.selectEl.dispatchEvent(new Event("change", { bubbles: true }));
	}
	options__(): { value: string; text: string }[] {
		return Array.from(this.selectEl.options).map((o) => ({ value: o.value, text: o.textContent ?? "" }));
	}
}

export class ButtonComponent extends BaseComponent {
	buttonEl: HTMLButtonElement;

	constructor(containerEl: HTMLElement) {
		super();
		this.buttonEl = document.createElement("button");
		containerEl.appendChild(this.buttonEl);
	}
	setButtonText(name: string): this {
		this.buttonEl.textContent = name;
		return this;
	}
	setIcon(icon: string): this {
		setIcon(this.buttonEl, icon);
		return this;
	}
	setClass(cls: string): this {
		this.buttonEl.className = cls;
		return this;
	}
	setCta(): this {
		this.buttonEl.classList.add("mod-cta");
		return this;
	}
	removeCta(): this {
		this.buttonEl.classList.remove("mod-cta");
		return this;
	}
	setWarning(): this {
		this.buttonEl.classList.add("mod-warning");
		return this;
	}
	setTooltip(tooltip: string): this {
		this.buttonEl.setAttribute("aria-label", tooltip);
		return this;
	}
	setDisabled(disabled: boolean): this {
		super.setDisabled(disabled);
		this.buttonEl.disabled = disabled;
		return this;
	}
	onClick(callback: (evt: MouseEvent) => any): this {
		this.buttonEl.addEventListener("click", callback);
		return this;
	}
	/** test helper */
	simulateClick__(): void {
		this.buttonEl.click();
	}
}

export class ExtraButtonComponent extends BaseComponent {
	extraSettingsEl: HTMLElement;
	constructor(containerEl: HTMLElement) {
		super();
		this.extraSettingsEl = document.createElement("div");
		this.extraSettingsEl.className = "clickable-icon extra-setting-button";
		containerEl.appendChild(this.extraSettingsEl);
	}
	setIcon(icon: string): this {
		setIcon(this.extraSettingsEl, icon);
		return this;
	}
	setTooltip(tooltip: string): this {
		this.extraSettingsEl.setAttribute("aria-label", tooltip);
		return this;
	}
	onClick(callback: () => any): this {
		this.extraSettingsEl.addEventListener("click", callback);
		return this;
	}
}

export class SliderComponent extends ValueComponent<number> {
	sliderEl: HTMLInputElement;
	private changeCallback__: ((value: number) => any) | null = null;
	constructor(containerEl: HTMLElement) {
		super();
		this.sliderEl = document.createElement("input");
		this.sliderEl.type = "range";
		containerEl.appendChild(this.sliderEl);
		this.sliderEl.addEventListener("change", () => this.changeCallback__?.(this.getValue()));
	}
	setLimits(min: number, max: number, step: number | "any"): this {
		this.sliderEl.min = String(min);
		this.sliderEl.max = String(max);
		this.sliderEl.step = String(step);
		return this;
	}
	getValue(): number {
		return Number(this.sliderEl.value);
	}
	setValue(value: number): this {
		this.sliderEl.value = String(value);
		return this;
	}
	setDynamicTooltip(): this {
		return this;
	}
	setInstant(_instant: boolean): this {
		return this;
	}
	onChange(callback: (value: number) => any): this {
		this.changeCallback__ = callback;
		return this;
	}
}

export class Setting {
	settingEl: HTMLElement;
	infoEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;
	controlEl: HTMLElement;
	components: BaseComponent[] = [];

	constructor(containerEl: HTMLElement) {
		this.settingEl = document.createElement("div");
		this.settingEl.className = "setting-item";
		this.infoEl = document.createElement("div");
		this.infoEl.className = "setting-item-info";
		this.nameEl = document.createElement("div");
		this.nameEl.className = "setting-item-name";
		this.descEl = document.createElement("div");
		this.descEl.className = "setting-item-description";
		this.infoEl.appendChild(this.nameEl);
		this.infoEl.appendChild(this.descEl);
		this.controlEl = document.createElement("div");
		this.controlEl.className = "setting-item-control";
		this.settingEl.appendChild(this.infoEl);
		this.settingEl.appendChild(this.controlEl);
		containerEl.appendChild(this.settingEl);
	}

	setName(name: string | DocumentFragment): this {
		this.nameEl.textContent = "";
		if (typeof name === "string") this.nameEl.textContent = name;
		else this.nameEl.appendChild(name);
		return this;
	}
	setDesc(desc: string | DocumentFragment): this {
		this.descEl.textContent = "";
		if (typeof desc === "string") this.descEl.textContent = desc;
		else this.descEl.appendChild(desc);
		return this;
	}
	setClass(cls: string): this {
		this.settingEl.classList.add(cls);
		return this;
	}
	setTooltip(tooltip: string): this {
		this.settingEl.setAttribute("aria-label", tooltip);
		return this;
	}
	setHeading(): this {
		this.settingEl.classList.add("setting-item-heading");
		return this;
	}
	setDisabled(disabled: boolean): this {
		this.settingEl.classList.toggle("is-disabled", disabled);
		for (const c of this.components) c.setDisabled(disabled);
		return this;
	}
	then(cb: (setting: this) => any): this {
		cb(this);
		return this;
	}
	/** Removes all components (their DOM lives in controlEl). */
	clear(): this {
		this.components = [];
		while (this.controlEl.firstChild) this.controlEl.removeChild(this.controlEl.firstChild);
		return this;
	}

	private add__<T extends BaseComponent>(component: T, cb: (component: T) => any): this {
		this.components.push(component);
		cb(component);
		return this;
	}
	addButton(cb: (component: ButtonComponent) => any): this {
		return this.add__(new ButtonComponent(this.controlEl), cb);
	}
	addExtraButton(cb: (component: ExtraButtonComponent) => any): this {
		return this.add__(new ExtraButtonComponent(this.controlEl), cb);
	}
	addToggle(cb: (component: ToggleComponent) => any): this {
		return this.add__(new ToggleComponent(this.controlEl), cb);
	}
	addText(cb: (component: TextComponent) => any): this {
		return this.add__(new TextComponent(this.controlEl), cb);
	}
	addSearch(cb: (component: SearchComponent) => any): this {
		return this.add__(new SearchComponent(this.controlEl), cb);
	}
	addTextArea(cb: (component: TextAreaComponent) => any): this {
		return this.add__(new TextAreaComponent(this.controlEl), cb);
	}
	addMomentFormat(cb: (component: MomentFormatComponent) => any): this {
		return this.add__(new MomentFormatComponent(this.controlEl), cb);
	}
	addDropdown(cb: (component: DropdownComponent) => any): this {
		return this.add__(new DropdownComponent(this.controlEl), cb);
	}
	addSlider(cb: (component: SliderComponent) => any): this {
		return this.add__(new SliderComponent(this.controlEl), cb);
	}

	// ---- test helpers -------------------------------------------------------------------------
	name__(): string {
		return this.nameEl.textContent ?? "";
	}
	component__<T extends BaseComponent>(ctor: new (...args: any[]) => T): T | undefined {
		return this.components.find((c): c is T => c instanceof ctor);
	}
}

export class MenuItem {
	title = "";
	icon: string | null = null;
	disabled = false;
	checked: boolean | null = null;
	section: string | undefined;
	private clickCallback__: ((evt: MouseEvent | KeyboardEvent) => any) | null = null;

	setTitle(title: string | DocumentFragment): this {
		this.title = typeof title === "string" ? title : (title.textContent ?? "");
		return this;
	}
	setIcon(icon: string | null): this {
		this.icon = icon;
		return this;
	}
	setChecked(checked: boolean | null): this {
		this.checked = checked;
		return this;
	}
	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		return this;
	}
	setIsLabel(_isLabel: boolean): this {
		return this;
	}
	setSection(section: string): this {
		this.section = section;
		return this;
	}
	onClick(callback: (evt: MouseEvent | KeyboardEvent) => any): this {
		this.clickCallback__ = callback;
		return this;
	}
	/** test helper: click the item */
	async trigger__(): Promise<void> {
		await this.clickCallback__?.(new MouseEvent("click"));
	}
}

export class Menu extends Component {
	items: MenuItem[] = [];
	addItem(cb: (item: MenuItem) => any): this {
		const item = new MenuItem();
		cb(item);
		this.items.push(item);
		return this;
	}
	addSeparator(): this {
		return this;
	}
	setNoIcon(): this {
		return this;
	}
	setUseNativeMenu(_useNative: boolean): this {
		return this;
	}
	showAtMouseEvent(_evt: MouseEvent): this {
		return this;
	}
	showAtPosition(_position: unknown, _doc?: Document): this {
		return this;
	}
	hide(): this {
		return this;
	}
	close(): void {}
	/** test helper: titles of the items in order */
	titles__(): string[] {
		return this.items.map((i) => i.title);
	}
	item__(title: string): MenuItem | undefined {
		return this.items.find((i) => i.title === title);
	}
}

export class WorkspaceLeaf {
	view: unknown = null;
}

export class View extends Component {
	app: App;
	leaf: WorkspaceLeaf;
	containerEl: HTMLElement = document.createElement("div");
	constructor(leaf: WorkspaceLeaf) {
		super();
		this.leaf = leaf;
		this.app = new App();
	}
}

export class ItemView extends View {}

export class Editor {
	private value__ = "";
	blurred__ = 0;
	getValue(): string {
		return this.value__;
	}
	setValue(v: string): void {
		this.value__ = v;
	}
	getDoc(): this {
		return this;
	}
	blur(): void {
		this.blurred__++;
	}
	focus(): void {}
	hasFocus(): boolean {
		return false;
	}
	replaceSelection(text: string): void {
		this.value__ += text;
	}
	getSelection(): string {
		return "";
	}
}

export class MarkdownView extends ItemView {
	editor: Editor;
	file: TFile | null = null;
	constructor(leaf: WorkspaceLeaf = new WorkspaceLeaf()) {
		super(leaf);
		this.editor = new Editor();
	}
	getViewType(): string {
		return "markdown";
	}
}

export class SuggestModal<T> extends Modal {
	inputEl: HTMLInputElement = document.createElement("input");
	setPlaceholder(_placeholder: string): void {}
	getSuggestions(_query: string): T[] | Promise<T[]> {
		return [];
	}
	renderSuggestion(_value: T, _el: HTMLElement): void {}
	onChooseSuggestion(_item: T, _evt: MouseEvent | KeyboardEvent): void {}
}

export class FuzzySuggestModal<T> extends SuggestModal<T> {
	getItems(): T[] {
		return [];
	}
	getItemText(_item: T): string {
		return "";
	}
	onChooseItem(_item: T, _evt: MouseEvent | KeyboardEvent): void {}
}

// ---------------------------------------------------------------------------------------------------
// test-only reset (called by tests/setup/common.ts)
// ---------------------------------------------------------------------------------------------------

export function __resetObsidianMock(): void {
	Notice.log = [];
	Modal.opened__ = [];
	Object.assign(Platform, PLATFORM_DEFAULTS);
}
