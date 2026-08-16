/** UI helpers: settings tab, modals, context menus, passphrase prompt. */
import { browser, $ } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { PLUGIN_ID } from "./plugin.js";

/** Open the plugin's settings tab via Obsidian's (undocumented but stable) `app.setting` API. */
export async function openSettingsTab(): Promise<void> {
	// Re-issue open()/openTabById() until the tab content is rendered: on the mobile UI (page stack) a
	// re-open after close() sometimes needs a second nudge.
	await browser.waitUntil(
		async () => {
			await browser.executeObsidian(({ app }, id) => {
				const setting = (app as any).setting;
				setting.open();
				setting.openTabById(id);
			}, PLUGIN_ID);
			await browser.pause(150);
			return $(".modal.mod-settings .vertical-tab-content .setting-item").isExisting();
		},
		{ timeout: 15_000, interval: 500, timeoutMsg: "gpgCrypt settings tab did not render" },
	);
}

/** Id of the currently active settings tab (works on desktop and mobile; falls back to lastTabId). */
export async function activeSettingsTabId(): Promise<string | undefined> {
	return browser.executeObsidian(({ app }) => {
		const s = (app as any).setting;
		return s?.activeTab?.id ?? (s?.lastTabId || undefined);
	});
}

/** Click a button by its exact text using the DOM (robust on small mobile viewports). */
export async function clickButtonByText(text: string): Promise<void> {
	const clicked = await browser.execute((text) => {
		const btn = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).reverse().find((b) => b.textContent?.trim() === text);
		if (!btn) return false;
		btn.click();
		return true;
	}, text);
	if (!clicked) throw new Error(`button "${text}" not found`);
}

/** The most recently opened modal (the settings dialog is itself a .modal-container). */
export function lastModal() {
	return $("(//div[contains(@class,'modal-container')])[last()]");
}

export async function closeSettings(): Promise<void> {
	await browser.executeObsidian(({ app }) => (app as any).setting.close());
}

/** Names of all `.setting-item` rows currently rendered in the settings tab (in order). */
export async function settingNames(): Promise<string[]> {
	return browser.execute(() =>
		Array.from(document.querySelectorAll(".modal.mod-settings .vertical-tab-content .setting-item .setting-item-name")).map(
			(el) => (el as HTMLElement).textContent?.trim() ?? "",
		),
	);
}

/** Whether a setting row (found by its name) is currently displayed. */
export async function settingVisible(name: string): Promise<boolean> {
	return browser.execute((name) => {
		const rows = Array.from(document.querySelectorAll(".modal.mod-settings .vertical-tab-content .setting-item"));
		const row = rows.find((r) => r.querySelector(".setting-item-name")?.textContent?.trim() === name) as HTMLElement | undefined;
		if (!row) return false;
		return row.style.display !== "none" && getComputedStyle(row).display !== "none";
	}, name);
}

/** The `.setting-item` row for a given name. */
export function settingRow(name: string) {
	// WDIO text selectors cannot be combined with CSS ancestors → chain from the settings modal
	return $(".modal.mod-settings").$(`.setting-item-name=${name}`).parentElement().parentElement();
}

export async function clickToggle(name: string): Promise<void> {
	const row = await settingRow(name);
	await row.$(".checkbox-container").click();
}

/** Right-click a file in the file explorer and click a menu item by (partial) text. nativeMenus must be false. */
export async function fileExplorerMenu(filePath: string, itemText: string): Promise<void> {
	await browser.executeObsidianCommand("file-explorer:open");
	const item = $(`.nav-files-container [data-path="${filePath}"]`);
	await item.waitForExist({ timeout: 10_000 });
	const platform = await obsidianPage.getPlatform();
	if (platform.isDesktopApp && !platform.isMobile) {
		await item.click({ button: "right" });
	} else {
		// mobile UI: no right click — dispatch a contextmenu event on the (awaited!) element
		const el = await item;
		await browser.execute((el) => {
			(el as HTMLElement).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
		}, el as unknown as HTMLElement);
		await browser.pause(300);
	}
	const menu = $(".menu");
	await menu.waitForExist({ timeout: 5_000 });
	await menu.$(`div.*=${itemText}`).click();
}

/** Titles of the currently open context menu (or [] if none). */
export async function contextMenuTitles(): Promise<string[]> {
	return browser.execute(() => Array.from(document.querySelectorAll(".menu .menu-item-title")).map((e) => e.textContent?.trim() ?? ""));
}

export function passphraseInput() {
	return $(".modal-container input[type=password]");
}

export async function typePassphrase(value: string): Promise<void> {
	const input = passphraseInput();
	await input.waitForExist({ timeout: 10_000 });
	await input.setValue(value);
	await browser.keys("Enter");
}

/**
 * Answer the passphrase prompt with `value` until `done()` holds. Re-answers if a prompt is (still)
 * visible.
 */
export async function answerPassphraseUntil(value: string, done: () => Promise<boolean>, timeout = 15_000): Promise<void> {
	const start = Date.now();
	let lastTyped = 0;
	while (Date.now() - start < timeout) {
		if (await done()) return;
		const inputs = await browser.$$(".modal-container input[type=password]");
		let visible: WebdriverIO.Element | undefined;
		for (const el of inputs) if (await el.isDisplayed()) visible = el; // last visible = newest prompt
		if (visible && Date.now() - lastTyped > 1_500) {
			await visible.setValue(value);
			await browser.keys("Enter");
			lastTyped = Date.now();
		}
		await browser.pause(250);
	}
	throw new Error(`answerPassphraseUntil: condition not reached within ${timeout} ms`);
}

export async function modalExists(selectorOrText?: string): Promise<boolean> {
	if (!selectorOrText) return $(".modal-container").isExisting();
	return browser.execute((text) => {
		return Array.from(document.querySelectorAll(".modal-container")).some((m) => (m.textContent ?? "").includes(text));
	}, selectorOrText);
}

export async function noticeTexts(): Promise<string[]> {
	return browser.execute(() => Array.from(document.querySelectorAll(".notice")).map((n) => n.textContent ?? ""));
}

export async function waitForNotice(text: string, timeout = 10_000): Promise<void> {
	await browser.waitUntil(async () => (await noticeTexts()).some((n) => n.includes(text)), {
		timeout,
		timeoutMsg: `Notice containing "${text}" not shown; got: ${JSON.stringify(await noticeTexts())}`,
	});
}

/** The plugin's status bar item (lock icon) — visible only for an encrypted active note. */
export function statusBarItem() {
	return $(`.status-bar .status-bar-item.plugin-${PLUGIN_ID}`);
}
