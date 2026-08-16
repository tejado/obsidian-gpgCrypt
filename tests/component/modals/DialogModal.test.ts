/**
 * DialogModal (src/modals/DialogModal.ts) — the Yes/No (or Ok) confirmation dialog used by the write hook,
 * the settings tab (recipient change) and the context-menu actions. Rendered against the `obsidian` mock
 * in happy-dom; asserts DOM + promise results only.
 */
import { describe, expect, test } from "vitest";
import { App } from "obsidian";
import DialogModal from "src/modals/DialogModal";

function buttons(modal: DialogModal): HTMLButtonElement[] {
	return Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>(".modal-button-container button"));
}

function buttonByText(modal: DialogModal, text: string): HTMLButtonElement {
	const btn = buttons(modal).find((b) => b.textContent === text);
	if (!btn) throw new Error(`no button "${text}"`);
	return btn;
}

describe("DialogModal rendering", () => {
	test("renders title, question and the optional additional paragraph", () => {
		const modal = new DialogModal(new App());
		void modal.openAndAwait("Really?", "It cannot be undone.");

		expect(modal.isOpen__).toBe(true);
		expect(document.body.contains(modal.containerEl)).toBe(true);
		expect(modal.contentEl.querySelector(".modal-title")?.textContent).toBe("Confirm");

		const paragraphs = Array.from(modal.contentEl.querySelectorAll("p")).map((p) => p.textContent);
		expect(paragraphs).toEqual(["Really?", "It cannot be undone."]);
	});

	test("omits the additional paragraph when none is passed", () => {
		const modal = new DialogModal(new App());
		void modal.openAndAwait("Really?");

		const paragraphs = Array.from(modal.contentEl.querySelectorAll("p")).map((p) => p.textContent);
		expect(paragraphs).toEqual(["Really?"]);
	});

	test("default yesNo: a 'Yes' call-to-action button and a plain 'No' button", () => {
		const modal = new DialogModal(new App());
		void modal.openAndAwait("Really?");

		expect(buttons(modal).map((b) => b.textContent)).toEqual(["Yes", "No"]);
		expect(buttonByText(modal, "Yes").classList.contains("mod-cta")).toBe(true);
		expect(buttonByText(modal, "No").classList.contains("mod-cta")).toBe(false);
	});

	test("yesNo=false: a single 'Ok' call-to-action button", () => {
		const modal = new DialogModal(new App());
		void modal.openAndAwait("FYI", undefined, false);

		expect(buttons(modal).map((b) => b.textContent)).toEqual(["Ok"]);
		expect(buttonByText(modal, "Ok").classList.contains("mod-cta")).toBe(true);
	});
});

describe("DialogModal results", () => {
	test("Yes resolves true and closes the modal", async () => {
		const modal = new DialogModal(new App());
		const result = modal.openAndAwait("Really?");

		buttonByText(modal, "Yes").click();

		expect(await result).toBe(true);
		expect(modal.isOpen__).toBe(false);
		expect(document.body.contains(modal.containerEl)).toBe(false);
	});

	test("No resolves false and closes the modal", async () => {
		const modal = new DialogModal(new App());
		const result = modal.openAndAwait("Really?");

		buttonByText(modal, "No").click();

		expect(await result).toBe(false);
		expect(modal.isOpen__).toBe(false);
		expect(document.body.contains(modal.containerEl)).toBe(false);
	});

	test("Ok (yesNo=false) resolves true", async () => {
		const modal = new DialogModal(new App());
		const result = modal.openAndAwait("FYI", "more", false);

		buttonByText(modal, "Ok").click();

		expect(await result).toBe(true);
		expect(modal.isOpen__).toBe(false);
	});

	test("close() (ESC / backdrop click) resolves false", async () => {
		const modal = new DialogModal(new App());
		const result = modal.openAndAwait("Really?");

		modal.close();

		expect(await result).toBe(false);
		expect(modal.isOpen__).toBe(false);
	});

	test("clicking the backdrop resolves false", async () => {
		const modal = new DialogModal(new App());
		const result = modal.openAndAwait("Really?");

		modal.containerEl.querySelector<HTMLElement>(".modal-bg")!.click();

		expect(await result).toBe(false);
		expect(modal.isOpen__).toBe(false);
	});

	test("onClose empties the content element", async () => {
		const modal = new DialogModal(new App());
		const result = modal.openAndAwait("Really?", "extra");
		expect(modal.contentEl.childElementCount).toBeGreaterThan(0);

		buttonByText(modal, "Yes").click();
		await result;

		expect(modal.contentEl.childElementCount).toBe(0);
		expect(modal.contentEl.textContent).toBe("");
	});

	// F25: a button click calls `resolve(value)` and then `close()`, which
	// calls `resolve(false)` again. Promises settle once, so the first value wins — this documents that
	// the button result is not overwritten by the dismiss value.
	test("resolve semantics: the button value wins over the resolve(false) issued by close()", async () => {
		const modal = new DialogModal(new App());
		const result = modal.openAndAwait("Really?");

		buttonByText(modal, "Yes").click();
		expect(await result).toBe(true);

		// a second close() after settling is harmless
		expect(() => modal.close()).not.toThrow();
		expect(await result).toBe(true);
	});
});
