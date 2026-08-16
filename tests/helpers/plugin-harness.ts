/**
 * Boots the real `GpgPlugin` (src/main.ts) against the fake App so that the adapter/vault/file-recovery
 * hooks can be exercised end-to-end without Obsidian. Used by tests/integration/** and the status bar
 * component test.
 */
import type { App, PluginManifest } from "obsidian";
import GpgPlugin from "src/main";
import type { Settings } from "src/settings/Settings";
import { createFakeApp, type FakeApp, type FakeAppOptions } from "../mocks/fake-app";
import { KEYS } from "./fixtures";
import manifest from "../../manifest.json";

 

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface HarnessOptions extends FakeAppOptions {
	/** which fixture key pair to place at public.asc/private.asc (null = no key files) */
	keys?: keyof typeof KEYS | null;
	/** vault files (path → on-disk content), seeded before the plugin loads */
	files?: Record<string, string>;
	/** extra empty folders */
	folders?: string[];
	/** settings merged (deep, one level) over the plugin defaults; firstLoad defaults to false */
	settings?: DeepPartial<Settings>;
	/** run the workspace.onLayoutReady callbacks (key loading, first-run modal, startup passphrase) */
	layoutReady?: boolean;
	/** call plugin.onload() (default true) */
	load?: boolean;
}

export interface Harness {
	app: FakeApp;
	plugin: GpgPlugin;
	/** raw on-disk content, bypassing every hook (undefined if the file does not exist) */
	disk: (path: string) => string | undefined;
	/** live settings object of the plugin */
	settings: () => Settings;
	/** persisted data.json */
	savedData: () => any;
	unload: () => Promise<void>;
}

export async function createPluginHarness(options: HarnessOptions = {}): Promise<Harness> {
	const { keys = "nopass", files = {}, folders = [], settings = {}, layoutReady = true, load = true, ...appOptions } = options;

	const seedFiles: Record<string, string> = { ...files };
	if (keys) {
		seedFiles["public.asc"] ??= KEYS[keys].publicKey;
		seedFiles["private.asc"] ??= KEYS[keys].privateKey;
	}
	const app = createFakeApp({ files: seedFiles, folders }, appOptions);

	const plugin = new GpgPlugin(app as unknown as App, manifest as PluginManifest);
	const { backendNative, backendWrapper, ...flat } = settings as any;
	(plugin as any).__data = {
		firstLoad: false,
		...flat,
		...(backendNative ? { backendNative: { publicKeyPath: "public.asc", privateKeyPath: "private.asc", ...backendNative } } : {}),
		...(backendWrapper
			? {
				backendWrapper: {
					executable: "gpg",
					recipient: "",
					trustModelAlways: false,
					compression: false,
					cache: true,
					showDecryptModal: true,
					...backendWrapper,
				},
			}
			: {}),
	};

	if (load) {
		await plugin.onload();
		if (layoutReady) await app.workspace.setLayoutReady__();
	}

	return {
		app,
		plugin,
		disk: (path) => app.vault.adapter.files.get(path),
		settings: () => (plugin as any).settings as Settings,
		savedData: () => (plugin as any).__data,
		unload: async () => {
			await plugin.onunload();
		},
	};
}

/** Let pending microtasks / short timers settle. */
export async function flush(ms = 0): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
	await Promise.resolve();
}

/** Poll until `pred()` is truthy (default 2 s). */
export async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 2000, stepMs = 5): Promise<void> {
	const start = Date.now();
	while (!(await pred())) {
		if (Date.now() - start > timeoutMs) throw new Error("waitFor: timeout");
		await new Promise((r) => setTimeout(r, stepMs));
	}
}
