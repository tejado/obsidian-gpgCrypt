/**
 * Plugin-level helpers for the E2E specs: settings presets, vault reset, raw disk access, error collector.
 *
 * IMPORTANT: while gpgCrypt is enabled, `obsidianPage.read()/write()` and `app.vault.adapter.*` go
 * through the plugin's hooks (reads return PLAINTEXT for encrypted notes, writes may get encrypted).
 * Every "what is really on disk" assertion therefore uses `node:fs` on the vault path (`diskRead`).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

export const PLUGIN_ID = "gpg-crypt";
export const PGP_MESSAGE_HEADER = "-----BEGIN PGP MESSAGE-----";
/** Plaintext canaries (must never appear on disk in a file that has to be encrypted; see 99-canary-sweep) */
export const CANARY = { edit: "CANARY_EDIT_1", typed: "CANARY_TYPED_2" };

/** data.json as committed in e2e/vaults/basic/.obsidian/plugins/gpg-crypt/data.json */
export const BASE_SETTINGS = {
	firstLoad: false,
	encryptAll: false,
	renameToGpg: false,
	foldersToEncrypt: [] as string[],
	fileRecovery: "encrypted",
	compatibilityMode: false,
	backend: "native",
	backendNative: { publicKeyPath: "public.asc", privateKeyPath: "private.asc" },
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
export type PluginSettings = typeof BASE_SETTINGS;

export const PRESETS = {
	default: {},
	encryptAll: { encryptAll: true },
	folders: { foldersToEncrypt: ["secret"] },
	rename: { encryptAll: true, renameToGpg: true },
	pwKey: { backendNative: { publicKeyPath: "public-pw.asc", privateKeyPath: "private-pw.asc" } },
	firstRun: { firstLoad: true },
} satisfies Record<string, Partial<PluginSettings> | { backendNative: PluginSettings["backendNative"] }>;

export function mergeSettings(...parts: Partial<PluginSettings>[]): PluginSettings {
	const out: PluginSettings = structuredClone(BASE_SETTINGS);
	for (const p of parts) {
		const { backendNative, backendWrapper, ...flat } = p as Partial<PluginSettings>;
		Object.assign(out, flat);
		if (backendNative) Object.assign(out.backendNative, backendNative);
		if (backendWrapper) Object.assign(out.backendWrapper, backendWrapper);
	}
	return out;
}

// ---- disk -----------------------------------------------------------------------------------

export function vaultPath(...rel: string[]): string {
	return path.join(obsidianPage.getVaultPath(), ...rel);
}

/** Raw file content, bypassing Obsidian and the plugin (undefined if missing). */
export function diskRead(rel: string): string | undefined {
	const p = vaultPath(rel);
	return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : undefined;
}

export function diskExists(rel: string): boolean {
	return fs.existsSync(vaultPath(rel));
}

export const PGP_MESSAGE_FOOTER = "-----END PGP MESSAGE-----";

/**
 * True for a COMPLETE armored OpenPGP message (header and footer present). Requiring the footer makes
 * disk polling robust against observing a partially written file (header already on disk, body not yet).
 */
export function isArmoredMessage(text: string | undefined): boolean {
	if (typeof text !== "string") return false;
	const t = text.trim();
	return t.startsWith(PGP_MESSAGE_HEADER) && t.endsWith(PGP_MESSAGE_FOOTER);
}

/** Precondition helpers — fail loudly instead of letting a test pass vacuously on stale vault state. */
export function expectCiphertextOnDisk(rel: string): void {
	const c = diskRead(rel);
	if (!isArmoredMessage(c)) throw new Error(`precondition: ${rel} should be ciphertext on disk, got: ${JSON.stringify(c?.slice(0, 60))}`);
}
export function expectPlaintextOnDisk(rel: string, mustContain?: string): void {
	const c = diskRead(rel);
	if (c === undefined) throw new Error(`precondition: ${rel} should exist on disk`);
	if (isArmoredMessage(c)) throw new Error(`precondition: ${rel} should be plaintext on disk but is an OpenPGP message`);
	if (mustContain && !c.includes(mustContain)) throw new Error(`precondition: ${rel} should contain ${JSON.stringify(mustContain)}, got: ${JSON.stringify(c.slice(0, 60))}`);
}

/** Poll the disk until `pred` holds (Obsidian saves asynchronously / debounced). */
export async function waitForDisk(rel: string, pred: (content: string | undefined) => boolean, timeout = 15_000): Promise<string | undefined> {
	await browser.waitUntil(() => pred(diskRead(rel)), { timeout, interval: 200, timeoutMsg: `disk state for ${rel} not reached` });
	return diskRead(rel);
}

export function readPluginData(): PluginSettings {
	return JSON.parse(diskRead(`.obsidian/plugins/${PLUGIN_ID}/data.json`) ?? "{}");
}

// ---- lifecycle -------------------------------------------------------------------------------

/**
 * Standard reset used by (almost) every spec:
 * disable plugin → reset vault files → write the settings preset to data.json (plugin disabled, so the
 * write is not intercepted) → enable plugin → install the console error collector.
 */
export async function resetWithSettings(...parts: Partial<PluginSettings>[]): Promise<void> {
	await obsidianPage.disablePlugin(PLUGIN_ID);
	await closeAllLeaves();
	await obsidianPage.resetVault();
	writePluginData(mergeSettings(...parts));
	await obsidianPage.enablePlugin(PLUGIN_ID);
	await installErrorCollector();
}

export function writePluginData(settings: PluginSettings): void {
	const p = vaultPath(".obsidian", "plugins", PLUGIN_ID, "data.json");
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, JSON.stringify(settings, null, "\t"));
}

/** Update settings of the RUNNING plugin (in-memory + data.json) and reload the key pair. */
export async function updateSettings(partial: Partial<PluginSettings>): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, partial) => {
		const plugin = (app as any).plugins.plugins[id];
		const s = plugin.settings;
		const { backendNative, backendWrapper, ...flat } = partial as any;
		Object.assign(s, flat);
		if (backendNative) Object.assign(s.backendNative, backendNative);
		if (backendWrapper) Object.assign(s.backendWrapper, backendWrapper);
		await plugin.saveSettings();
		await plugin.loadKeypair();
	}, PLUGIN_ID, partial);
}

export async function closeAllLeaves(): Promise<void> {
	await browser.executeObsidian(({ app }) => {
		app.workspace.detachLeavesOfType("markdown");
	});
	// Dismiss leftover modals (e.g. a pending passphrase prompt) through their own buttons so the
	// promises behind them settle; remove anything that is still there afterwards.
	await browser.executeObsidian(() => {
		for (const modal of Array.from(document.querySelectorAll<HTMLElement>(".modal-container"))) {
			const buttons = Array.from(modal.querySelectorAll<HTMLButtonElement>("button"));
			const dismiss = buttons.find((b) => /^(Cancel|No|Close|Skip configuration|Ok|Hide)$/.test(b.textContent?.trim() ?? ""));
			if (dismiss) dismiss.click();
		}
		document.querySelectorAll<HTMLElement>(".modal-container").forEach((m) => m.remove());
	});
}

/**
 * Open a note WITHOUT awaiting Obsidian's open promise inside the page. Needed whenever the read will
 * block on user input (passphrase modal): `obsidianPage.openFile()` awaits the read, which awaits the
 * modal, which can only be answered by the next WebDriver command → deadlock.
 */
export async function openFileInBackground(path: string): Promise<void> {
	await browser.executeObsidian(({ app }, path) => {
		const file = app.vault.getFileByPath(path);
		if (!file) throw new Error(`no such file in vault: ${path}`);
		void app.workspace.getLeaf(true).openFile(file);
	}, path);
}

export async function isPluginEnabled(): Promise<boolean> {
	return browser.executeObsidian(({ app }, id) => (app as any).plugins.enabledPlugins.has(id), PLUGIN_ID);
}

/** Read the plaintext the editor shows for the active markdown view. */
export async function activeEditorText(): Promise<string | null> {
	return browser.executeObsidian(({ app, obsidian }) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		return view ? view.editor.getValue() : null;
	});
}

/** Decrypt raw ciphertext with the plugin's own OpenPGP.js backend (nopass key must be loaded). */
export async function decryptWithPlugin(ciphertext: string, passphrase: string | null = null): Promise<string> {
	return browser.executeObsidian(
		async ({ app }, id, ct, pw) => {
			const plugin = (app as any).plugins.plugins[id];
			return plugin.gpgNative.decrypt(ct, pw);
		},
		PLUGIN_ID,
		ciphertext,
		passphrase,
	);
}

// ---- console error collector ---------------------------------------------------------------------

/**
 * WDIO v9 has no `getLogs` and wdio-obsidian-service forces the classic protocol (no BiDi log events),
 * so errors are collected inside the page: console.error, window "error" and unhandled rejections.
 */
export async function installErrorCollector(): Promise<void> {
	await browser.executeObsidian(() => {
		const w = window as any;
		if (w.__gpgErrs) {
			w.__gpgErrs.length = 0;
			return;
		}
		w.__gpgErrs = [] as string[];
		const orig = console.error;
		console.error = (...args: unknown[]) => {
			w.__gpgErrs.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ""}` : String(a))).join(" "));
			orig.apply(console, args);
		};
		window.addEventListener("error", (e) => w.__gpgErrs.push(`error: ${e.message}`));
		window.addEventListener("unhandledrejection", (e) => {
			const r = (e as PromiseRejectionEvent).reason;
			w.__gpgErrs.push(`unhandledrejection: ${r instanceof Error ? `${r.message}\n${r.stack ?? ""}` : String(r)}`);
		});
	});
}

export async function collectedErrors(): Promise<string[]> {
	return browser.executeObsidian(() => ((window as any).__gpgErrs ?? []) as string[]);
}

/**
 * Errors that mention the plugin (Obsidian itself logs benign warnings we do not own).
 * The F10 message ("Attempting to load NodeJS package: child_process", logged by Obsidian's mobile
 * `require` shim because spawnGPG.ts imports child_process at module scope) is excluded here and
 * asserted explicitly by 00-smoke as a known bug (F10).
 */
export const F10_MESSAGE = "Attempting to load NodeJS package";
const PLUGIN_ERROR = /gpg-crypt|gpgCrypt|plugin:gpg-crypt|openpgp/i;
export async function pluginErrors(): Promise<string[]> {
	const all = await collectedErrors();
	return all.filter(
		(e) =>
			!e.includes(F10_MESSAGE) &&
			// mentions the plugin (message or stack), or is an uncaught error / unhandled rejection —
			// those have no owner in a driven Obsidian session other than the code under test
			(PLUGIN_ERROR.test(e) || e.startsWith("unhandledrejection:") || e.startsWith("error:")),
	);
}

/** Errors mentioning the plugin INCLUDING the F10 message. */
export async function pluginErrorsUnfiltered(): Promise<string[]> {
	const all = await collectedErrors();
	return all.filter((e) => /gpg-crypt|gpgCrypt|plugin:gpg-crypt|openpgp/i.test(e));
}
