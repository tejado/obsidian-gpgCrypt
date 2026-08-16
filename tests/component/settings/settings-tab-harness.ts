/**
 * Shared scaffolding for the SettingsTab / InputList component tests: a full default `Settings` object
 * (mirrors main.ts loadSettings DEFAULT_SETTINGS), a fake plugin exposing exactly what SettingsTab calls,
 * and DOM helpers that interact with the rendered rows the way a user would (events, not component APIs).
 */
import { vi } from "vitest";
import type { App } from "obsidian";
import GpgPlugin from "src/main";
import { SettingsTab } from "src/settings/SettingsTab";
import { FileRecovery, type Settings } from "src/settings/Settings";
import { Backend } from "src/backend/Backend";
import { CliPathStatus } from "src/backend/wrapper/BackendWrapper";
import { createFakeApp, type FakeApp } from "../../mocks/fake-app";

 

/** Copy of the plugin defaults (src/main.ts loadSettings). */
export function defaultSettings(): Settings {
	return {
		firstLoad: true,
		encryptAll: false,
		renameToGpg: false,
		foldersToEncrypt: [],
		fileRecovery: FileRecovery.ENCRYPTED,
		compatibilityMode: false,
		backend: Backend.NATIVE,
		backendNative: {
			publicKeyPath: "public.asc",
			privateKeyPath: "private.asc",
		},
		backendWrapper: {
			executable: "gpg",
			recipient: "",
			trustModelAlways: false,
			compression: false,
			cache: true,
			showDecryptModal: true,
		},
		askPassphraseOnStartup: false,
		passphraseTimeout: 300,
		resetPassphraseTimeoutOnWrite: false,
	};
}

export interface FakePlugin {
	saveSettings: ReturnType<typeof vi.fn>;
	loadKeypair: ReturnType<typeof vi.fn>;
	generateKeypair: ReturnType<typeof vi.fn>;
	cache: { setTimeout: ReturnType<typeof vi.fn> };
	gpgWrapper: {
		isGPG: ReturnType<typeof vi.fn>;
		getPublicKeys: ReturnType<typeof vi.fn>;
		setExecutable: ReturnType<typeof vi.fn>;
	};
}

export function makeFakePlugin(): FakePlugin {
	return {
		saveSettings: vi.fn(async () => undefined),
		loadKeypair: vi.fn(async () => undefined),
		generateKeypair: vi.fn(async () => true),
		cache: { setTimeout: vi.fn() },
		gpgWrapper: {
			isGPG: vi.fn(async () => CliPathStatus.FOUND),
			getPublicKeys: vi.fn(async () => []),
			setExecutable: vi.fn(),
		},
	};
}

export interface MountOptions {
	settings?: Partial<Settings>;
	/** vault folders that exist (FolderValidator) — default ["secret"] */
	folders?: string[];
	/** tweak the fake plugin before display() */
	plugin?: (plugin: FakePlugin) => void;
	/** skip display() */
	noDisplay?: boolean;
}

export interface Mounted {
	app: FakeApp;
	plugin: FakePlugin;
	settings: Settings;
	tab: SettingsTab;
	/** ordered `.setting-item-name` texts */
	names: () => string[];
	/** the `settingEl` of the row with this name (the element SettingsTab shows/hides) */
	row: (name: string) => HTMLElement;
	toggle: (name: string) => HTMLElement;
	select: (name: string) => HTMLSelectElement;
	input: (name: string) => HTMLInputElement;
	button: (name: string, text?: string) => HTMLButtonElement;
}

export function mountSettingsTab(options: MountOptions = {}): Mounted {
	const app = createFakeApp({ folders: options.folders ?? ["secret"] });
	// FolderValidator reads the vault through the static GpgPlugin.APP
	GpgPlugin.APP = app as unknown as App;

	const plugin = makeFakePlugin();
	options.plugin?.(plugin);
	const settings: Settings = { ...defaultSettings(), ...options.settings };
	const tab = new SettingsTab(app as unknown as App, plugin as any, settings);
	if (!options.noDisplay) tab.display();

	const nameEls = () => Array.from(tab.containerEl.querySelectorAll<HTMLElement>(".setting-item-name"));
	const row = (name: string): HTMLElement => {
		const nameEl = nameEls().find((el) => el.textContent === name);
		if (!nameEl) throw new Error(`no setting row named "${name}"`);
		// .setting-item > .setting-item-info > .setting-item-name
		return nameEl.parentElement!.parentElement!;
	};
	const pick = <T extends Element>(name: string, selector: string): T => {
		const el = row(name).querySelector<T>(selector);
		if (!el) throw new Error(`row "${name}" has no ${selector}`);
		return el;
	};

	return {
		app,
		plugin,
		settings,
		tab,
		names: () => nameEls().map((el) => el.textContent ?? ""),
		row,
		toggle: (name) => pick<HTMLElement>(name, ".checkbox-container"),
		select: (name) => pick<HTMLSelectElement>(name, "select"),
		input: (name) => pick<HTMLInputElement>(name, "input"),
		button: (name, text) => {
			const buttons = Array.from(row(name).querySelectorAll<HTMLButtonElement>("button"));
			const btn = text === undefined ? buttons[0] : buttons.find((b) => b.textContent === text);
			if (!btn) throw new Error(`row "${name}" has no button ${text ?? ""}`);
			return btn;
		},
	};
}

/** Type into a text input like the user (fires "input", which TextComponent listens to). */
export function typeInto(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Pick a dropdown value like the user (fires "change"). */
export function choose(select: HTMLSelectElement, value: string): void {
	select.value = value;
	select.dispatchEvent(new Event("change", { bubbles: true }));
}

export function optionsOf(select: HTMLSelectElement): { value: string; text: string }[] {
	return Array.from(select.options).map((o) => ({ value: o.value, text: o.textContent ?? "" }));
}

/** Let the async settings callbacks (isGPG / getPublicKeys / saveSettings chains) settle. */
export async function flush(): Promise<void> {
	await new Promise((r) => setTimeout(r, 0));
	await Promise.resolve();
}
