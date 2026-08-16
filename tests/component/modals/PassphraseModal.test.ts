/**
 * PassphraseModal (src/modals/PassphraseModal.ts) — asks for the private-key passphrase (native backend).
 * Covers rendering, keyboard/submit/cancel semantics, editor blur on open and the F25 polish items.
 */
import { describe, expect, test, vi } from "vitest";
import { MarkdownView } from "obsidian";
import PassphraseModal from "src/modals/PassphraseModal";
import { createFakeApp } from "../../mocks/fake-app";

const DESCRIPTION = ' for private key "private.asc"';

const race = <T>(p: Promise<T>, ms = 30) =>
	Promise.race([p, new Promise<"TIMEOUT">((r) => setTimeout(() => r("TIMEOUT"), ms))]);

/** `open()` → with DESCRIPTION; `open(null)` → `openAndAwait()` without any argument. */
function open(description: string | null = DESCRIPTION) {
	// the base `App` mock has no `workspace.getActiveViewOfType`; the fake App does
	const modal = new PassphraseModal(createFakeApp());
	const result = description === null ? modal.openAndAwait() : modal.openAndAwait(description);
	const input = modal.contentEl.querySelector<HTMLInputElement>("input")!;
	const submit = modal.contentEl.querySelector<HTMLButtonElement>("button.mod-cta")!;
	const cancel = Array.from(modal.contentEl.querySelectorAll("button")).find((b) => b.textContent === "Cancel")!;
	return { modal, result, input, submit, cancel };
}

function pressEnter(input: HTMLInputElement): KeyboardEvent {
	const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
	input.dispatchEvent(event);
	return event;
}

describe("PassphraseModal rendering", () => {
	test("title, password input with placeholder and z-index above the loading screen", () => {
		const { modal, result, input, submit, cancel } = open();
		result.catch(() => undefined);

		expect(modal.contentEl.querySelector(".modal-title")?.textContent).toBe('Enter passphrase for private key "private.asc"');
		expect(input.type).toBe("password");
		expect(input.placeholder).toBe('Enter your passphrase for private key "private.asc"...');
		expect(modal.containerEl.style.zIndex).toBe("99999");
		expect(submit.textContent).toBe("Submit");
		expect(cancel).toBeDefined();
		expect(document.body.contains(modal.containerEl)).toBe(true);
	});
});

describe("PassphraseModal results", () => {
	test("typing a passphrase and clicking Submit resolves with the value and closes", async () => {
		const { modal, result, input, submit } = open();

		input.value = "s3cret";
		submit.click();

		expect(await result).toBe("s3cret");
		expect(modal.isOpen__).toBe(false);
		expect(document.body.contains(modal.containerEl)).toBe(false);
		expect(modal.contentEl.childElementCount).toBe(0);
	});

	test("Enter with a non-empty value submits and prevents the default", async () => {
		const { modal, result, input } = open();

		input.value = "hunter2";
		const event = pressEnter(input);

		expect(event.defaultPrevented).toBe(true);
		expect(await result).toBe("hunter2");
		expect(modal.isOpen__).toBe(false);
	});

	test("Enter with an empty value does nothing (promise stays pending)", async () => {
		const { modal, result, input } = open();
		result.catch(() => undefined);

		const event = pressEnter(input);

		expect(event.defaultPrevented).toBe(false);
		expect(await race(result)).toBe("TIMEOUT");
		expect(modal.isOpen__).toBe(true);
	});

	test("Cancel rejects with a descriptive error and closes", async () => {
		const { modal, result, cancel } = open();

		cancel.click();

		await expect(result).rejects.toThrow('No passphrase for private key "private.asc" provided!');
		expect(modal.isOpen__).toBe(false);
	});

	test("close() (ESC / backdrop) rejects", async () => {
		const { modal, result } = open();

		modal.close();

		await expect(result).rejects.toThrow('No passphrase for private key "private.asc" provided!');
		expect(modal.isOpen__).toBe(false);
	});

	test("opening blurs the editor of the active MarkdownView", async () => {
		const app = createFakeApp({ files: { "Note.md": "hello" } });
		app.workspace.setActiveFile__(app.vault.getFileByPath("Note.md"));
		const view = app.workspace.getActiveViewOfType(MarkdownView)!;
		expect(view.editor.blurred__).toBe(0);

		const modal = new PassphraseModal(app);
		const result = modal.openAndAwait(DESCRIPTION);
		result.catch(() => undefined);

		expect(view.editor.blurred__).toBe(1);
		modal.close();
		await expect(result).rejects.toThrow();
	});

	test("opening without an active MarkdownView does not throw", async () => {
		const app = createFakeApp();
		const modal = new PassphraseModal(app);
		const result = modal.openAndAwait(DESCRIPTION);
		result.catch(() => undefined);
		expect(modal.isOpen__).toBe(true);
		modal.close();
		await expect(result).rejects.toThrow();
	});
});

describe("PassphraseModal polish (F25)", () => {
	// F25 — PassphraseModal.ts:67 logs "press enter" on every keydown inside a password field.
	test.fails("[F25] no console.log on keydown in the password field", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const { modal, result, input } = open();
		result.catch(() => undefined);

		input.value = "a";
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));

		try {
			expect(log).not.toHaveBeenCalled();
		} finally {
			modal.close();
			await result.catch(() => undefined);
		}
	});

	// F25 — title/placeholder/error interpolate `undefined` when no description is passed.
	test.fails("[F25] title without description does not contain 'undefined'", async () => {
		const { modal, result, input } = open(null);
		result.catch(() => undefined);

		try {
			expect(modal.contentEl.querySelector(".modal-title")?.textContent).not.toContain("undefined");
			expect(input.placeholder).not.toContain("undefined");
		} finally {
			modal.close();
			await result.catch(() => undefined);
		}
	});
});
