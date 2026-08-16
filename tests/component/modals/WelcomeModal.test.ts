/**
 * WelcomeModal (src/modals/WelcomeModal.ts) — first-run / "Show welcome dialog" screen.
 * Resolves "gen-key" | "open-settings" | "" depending on the button (or dismissal).
 */
import { describe, expect, test } from "vitest";
import { App, Platform } from "obsidian";
import WelcomeModal from "src/modals/WelcomeModal";

function open(firstLoad: boolean) {
	const modal = new WelcomeModal(new App(), firstLoad);
	const result = modal.openAndAwait();
	const buttons = Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>(".modal-button-container button"));
	const button = (text: string) => {
		const b = buttons.find((x) => x.textContent === text);
		if (!b) throw new Error(`no button "${text}"`);
		return b;
	};
	const paragraphs = () => Array.from(modal.contentEl.querySelectorAll("p")).map((p) => p.textContent ?? "");
	return { modal, result, buttons, button, paragraphs };
}

describe("WelcomeModal rendering", () => {
	test("firstLoad=true: heading and the three buttons (two call-to-action)", () => {
		const { modal, buttons, button } = open(true);

		expect(modal.contentEl.querySelector("h2")?.textContent).toBe("Welcome to gpgCrypt 🔒");
		expect(buttons.map((b) => b.textContent)).toEqual([
			"Generate new key pair...",
			"Open settings to use existing key pair...",
			"Skip configuration",
		]);
		expect(button("Generate new key pair...").classList.contains("mod-cta")).toBe(true);
		expect(button("Open settings to use existing key pair...").classList.contains("mod-cta")).toBe(true);
		expect(button("Skip configuration").classList.contains("mod-cta")).toBe(false);
		expect(document.body.contains(modal.containerEl)).toBe(true);
	});

	test("firstLoad=false: only 'Generate new key pair...' and 'Close'", () => {
		const { buttons, button } = open(false);

		expect(buttons.map((b) => b.textContent)).toEqual(["Generate new key pair...", "Close"]);
		expect(button("Generate new key pair...").classList.contains("mod-cta")).toBe(true);
		expect(button("Close").classList.contains("mod-cta")).toBe(false);
	});

	test("desktop: mentions the GnuPG CLI wrapper / smartcard option", () => {
		const { paragraphs } = open(true);
		const text = paragraphs().join("\n");
		expect(text).toContain("Smartcard");
		expect(text).toContain("Yubikey");
		expect(text).not.toContain("not supported on mobile devices");
	});

	test("mobile: states that the GnuPG CLI wrapper is not supported", () => {
		Platform.isMobile = true;
		const { paragraphs } = open(true);
		const text = paragraphs().join("\n");
		expect(text).toContain("not supported on mobile devices");
		expect(text).not.toContain("Yubikey");
	});

	test("the learn-more link points to the GitHub repository and opens in a new tab", () => {
		const { modal } = open(true);
		const link = modal.contentEl.querySelector<HTMLAnchorElement>("a")!;
		expect(link.textContent).toBe("github.com/tejado/obsidian-gpgCrypt");
		expect(link.getAttribute("href")).toBe("https://github.com/tejado/obsidian-gpgCrypt");
		expect(link.getAttribute("target")).toBe("_blank");
	});

	test("lists the steps for using an existing key pair", () => {
		const { modal } = open(true);
		const steps = Array.from(modal.contentEl.querySelectorAll("ol li")).map((li) => li.textContent ?? "");
		expect(steps).toHaveLength(3);
		expect(steps[0]).toContain("public.asc and private.asc");
		expect(steps[2]).toContain("'Public key' and 'Private key'");
	});
});

describe("WelcomeModal results", () => {
	test("'Generate new key pair...' resolves \"gen-key\" and closes", async () => {
		const { modal, result, button } = open(true);
		button("Generate new key pair...").click();
		expect(await result).toBe("gen-key");
		expect(modal.isOpen__).toBe(false);
		expect(document.body.contains(modal.containerEl)).toBe(false);
	});

	test("'Open settings to use existing key pair...' resolves \"open-settings\" and closes", async () => {
		const { modal, result, button } = open(true);
		button("Open settings to use existing key pair...").click();
		expect(await result).toBe("open-settings");
		expect(modal.isOpen__).toBe(false);
	});

	test("'Skip configuration' resolves \"\" and closes", async () => {
		const { modal, result, button } = open(true);
		button("Skip configuration").click();
		expect(await result).toBe("");
		expect(modal.isOpen__).toBe(false);
	});

	test("'Close' (firstLoad=false) resolves \"\" and closes", async () => {
		const { modal, result, button } = open(false);
		button("Close").click();
		expect(await result).toBe("");
		expect(modal.isOpen__).toBe(false);
	});

	test("close() (ESC / backdrop) resolves \"\"", async () => {
		const { modal, result } = open(true);
		modal.close();
		expect(await result).toBe("");
		expect(modal.isOpen__).toBe(false);
		expect(modal.contentEl.childElementCount).toBe(0);
	});
});
