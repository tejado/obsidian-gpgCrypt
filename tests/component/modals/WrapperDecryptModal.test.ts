/**
 * WrapperDecryptModal (src/modals/WrapperDecryptModal.ts) — the blocking "Decryption in progress..." dialog
 * shown while the GnuPG CLI wrapper decrypts a note. It removes the close button and the backdrop click
 * handler on purpose; the cancel button only appears once `setOnCancelFn` wires a cancel function.
 */
import { describe, expect, test, vi } from "vitest";
import { App, Notice } from "obsidian";
import WrapperDecryptModal from "src/modals/WrapperDecryptModal";

function open(fileName = "Note.md") {
	const modal = new WrapperDecryptModal(new App(), fileName);
	const originalBg = modal.containerEl.querySelector<HTMLElement>(".modal-bg")!;
	modal.open();
	const buttons = Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>(".modal-button-container button"));
	const cancelBtn = buttons.find((b) => b.textContent === "Cancel Decryption")!;
	const hideBtn = buttons.find((b) => b.textContent === "Hide")!;
	return { modal, originalBg, buttons, cancelBtn, hideBtn };
}

describe("WrapperDecryptModal rendering", () => {
	test("title, file name paragraph, instructions and z-index above the loading screen", () => {
		const { modal } = open("Note.md");

		expect(modal.titleEl.textContent).toBe("Decryption in progress...");
		expect(modal.contentEl.querySelector("p")?.textContent).toContain('"Note.md"');
		expect(modal.contentEl.querySelectorAll("ul li")).toHaveLength(2);
		expect(modal.contentEl.querySelector("li strong.mod-warning")?.textContent).toBe("only in prompts you trust and expect.");
		expect(modal.containerEl.style.zIndex).toBe("99999");
		expect(document.body.contains(modal.containerEl)).toBe(true);
	});

	test("the modal close button is removed", () => {
		const { modal } = open();
		expect(modal.modalEl.querySelector(".modal-close-button")).toBeNull();
	});

	test("the backdrop is replaced by a clone without click listeners (clicking it does not close)", () => {
		const { modal, originalBg } = open();

		const newBg = modal.containerEl.querySelector<HTMLElement>(".modal-bg")!;
		expect(newBg).not.toBe(originalBg);
		expect(modal.containerEl.contains(originalBg)).toBe(false);
		expect(originalBg.isConnected).toBe(false);

		newBg.click();
		expect(modal.isOpen__).toBe(true);
		expect(document.body.contains(modal.containerEl)).toBe(true);
	});

	test("buttons: 'Cancel Decryption' (initially hidden) and 'Hide' (call-to-action)", () => {
		const { buttons, cancelBtn, hideBtn } = open();

		expect(buttons.map((b) => b.textContent)).toEqual(["Cancel Decryption", "Hide"]);
		expect(cancelBtn.style.display).toBe("none");
		expect(hideBtn.classList.contains("mod-cta")).toBe(true);
	});
});

describe("WrapperDecryptModal behaviour", () => {
	test("setOnCancelFn shows the cancel button; clicking it calls the fn, notifies and closes", () => {
		const { modal, cancelBtn } = open("Note.md");
		const cancel = vi.fn();

		modal.setOnCancelFn(cancel);
		expect(cancelBtn.style.display).toBe("");

		cancelBtn.click();

		expect(cancel).toHaveBeenCalledTimes(1);
		expect(Notice.messages()).toContain('Decryption of "Note.md" canceled.');
		expect(modal.isOpen__).toBe(false);
		expect(document.body.contains(modal.containerEl)).toBe(false);
		expect(modal.contentEl.childElementCount).toBe(0);
	});

	test("'Hide' closes the modal without a Notice", () => {
		const { modal, hideBtn } = open();

		hideBtn.click();

		expect(modal.isOpen__).toBe(false);
		expect(document.body.contains(modal.containerEl)).toBe(false);
		expect(Notice.messages()).toEqual([]);
	});

	// main.ts creates the modal unconditionally and only guards open()/close() by the "Show decryption
	// dialog" setting; a close() on a never-opened modal must stay harmless (Obsidian tolerates it too).
	test("close() before open() does not throw", () => {
		const modal = new WrapperDecryptModal(new App(), "Note.md");
		expect(() => modal.close()).not.toThrow();
		expect(modal.isOpen__).toBe(false);
		expect(document.body.contains(modal.containerEl)).toBe(false);
	});

	// Documents the current contract: the cancel button element only exists after onOpen(); calling
	// setOnCancelFn earlier dereferences an undefined `cancelBtn`.
	test("setOnCancelFn before onOpen throws (cancelBtn undefined)", () => {
		const modal = new WrapperDecryptModal(new App(), "Note.md");
		expect(() => modal.setOnCancelFn(() => undefined)).toThrow(TypeError);
	});
});
