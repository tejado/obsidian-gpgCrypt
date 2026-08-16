/**
 * GenerateKeypairModal (src/modals/GenerateKeypairModal.ts) — the "Generate new key pair" form.
 * Rows are hand-rolled `.setting-item` markup (F25); the passphrase indicator is driven by "input" events.
 */
import { describe, expect, test } from "vitest";
import { App } from "obsidian";
import GenerateKeypairModal from "src/modals/GenerateKeypairModal";

const ROW_NAMES = ["Name", "E-mail address", "Public key name", "Private key name", "Passphrase", "Confirm passphrase"];

function open() {
	const modal = new GenerateKeypairModal(new App());
	const result = modal.openAndAwait();
	const rows = Array.from(modal.contentEl.querySelectorAll<HTMLElement>(".setting-item"));
	const inputs = rows.map((r) => r.querySelector<HTMLInputElement>("input")!);
	const descs = rows.map((r) => r.querySelector<HTMLElement>(".setting-item-description")!);
	const buttons = Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>(".modal-button-container button"));
	const submit = buttons.find((b) => b.textContent === "Generate Key Pair")!;
	const cancel = buttons.find((b) => b.textContent === "Cancel")!;
	return {
		modal,
		result,
		rows,
		inputs,
		submit,
		cancel,
		name: inputs[0],
		email: inputs[1],
		publicKey: inputs[2],
		privateKey: inputs[3],
		passphrase: inputs[4],
		confirm: inputs[5],
		confirmDesc: descs[5],
	};
}

/** Type as the user would: set the value and fire the "input" event the modal listens to. */
function type(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("GenerateKeypairModal rendering", () => {
	test("title, intro paragraph and six form rows in order", () => {
		const { modal, result, rows } = open();
		result.catch(() => undefined);

		expect(modal.contentEl.querySelector(".modal-title")?.textContent).toBe("Generate new key pair");
		expect(modal.contentEl.querySelector("p")?.textContent).toContain("Generate a new key pair with gpgCrypt");
		expect(rows.map((r) => r.querySelector(".setting-item-name")?.textContent)).toEqual(ROW_NAMES);
		expect(rows.every((r) => r.querySelector(".setting-item-description")?.textContent)).toBe(true);
	});

	test("default values and input types", () => {
		const { result, inputs, name, email, publicKey, privateKey, passphrase, confirm } = open();
		result.catch(() => undefined);

		expect(inputs.map((i) => i.getAttribute("value"))).toEqual([
			"Obsidian Key Pair",
			"obsidian@example.com",
			"public.asc",
			"private.asc",
			null,
			null,
		]);
		expect([name, email, publicKey, privateKey].map((i) => i.type)).toEqual(["text", "text", "text", "text"]);
		expect(passphrase.type).toBe("password");
		expect(confirm.type).toBe("password");
	});

	test("Submit is the call-to-action button, Cancel is plain", () => {
		const { result, submit, cancel } = open();
		result.catch(() => undefined);

		expect(submit.classList.contains("mod-cta")).toBe(true);
		expect(cancel.classList.contains("mod-cta")).toBe(false);
	});
});

describe("GenerateKeypairModal passphrase indicator", () => {
	test("different passphrases: warning text, mod-warning and a disabled submit button", () => {
		const { result, passphrase, confirm, confirmDesc, submit } = open();
		result.catch(() => undefined);

		type(passphrase, "abc");
		type(confirm, "abd");

		expect(confirmDesc.textContent).toContain("Passphrases are different.");
		expect(confirmDesc.classList.contains("mod-warning")).toBe(true);
		expect(confirmDesc.classList.contains("mod-success")).toBe(false);
		expect(submit.hasAttribute("disabled")).toBe(true);
		expect(submit.disabled).toBe(true);
	});

	test("equal passphrases: success text, mod-success and an enabled submit button", () => {
		const { result, passphrase, confirm, confirmDesc, submit } = open();
		result.catch(() => undefined);

		type(passphrase, "abc");
		expect(submit.disabled).toBe(true); // "abc" vs "" is different
		type(confirm, "abc");

		expect(confirmDesc.textContent).toContain("Passphrases are the same.");
		expect(confirmDesc.classList.contains("mod-success")).toBe(true);
		expect(confirmDesc.classList.contains("mod-warning")).toBe(false);
		expect(submit.hasAttribute("disabled")).toBe(false);
	});

	// F25 — the indicator is only wired to "input" events; nothing evaluates it on open, so the submit
	// button starts ENABLED although no passphrase has been confirmed and the description shows
	// neither state. This documents the current behaviour (a normal test, not test.fails).
	test("[F25] indicator is not evaluated on open (submit enabled with empty passphrases)", () => {
		const { result, submit, confirmDesc } = open();
		result.catch(() => undefined);

		expect(submit.hasAttribute("disabled")).toBe(false);
		expect(confirmDesc.textContent).toBe("Confirm the passphrase.");
		expect(confirmDesc.classList.contains("mod-warning")).toBe(false);
		expect(confirmDesc.classList.contains("mod-success")).toBe(false);
	});

	// F25 — `confirmPassphraseDesc.style.color = "green"` is set once the passphrases match and never
	// reverted when they differ again (the mod-warning class then fights the inline style).
	test.fails("[F25] inline green colour is reverted when passphrases differ again", () => {
		const { result, passphrase, confirm, confirmDesc } = open();
		result.catch(() => undefined);

		type(passphrase, "abc");
		type(confirm, "abc");
		expect(confirmDesc.style.color).toBe("green");

		type(confirm, "abd");
		expect(confirmDesc.classList.contains("mod-warning")).toBe(true);
		expect(confirmDesc.style.color).toBe("");
	});
});

describe("GenerateKeypairModal results", () => {
	test("Submit resolves the form values with normalizePath applied to the file names", async () => {
		const { modal, result, name, email, publicKey, privateKey, passphrase, confirm, submit } = open();

		type(name, "Alice");
		type(email, "alice@example.com");
		type(publicKey, "keys//pub.asc");
		type(privateKey, "/keys/priv.asc/");
		type(passphrase, "pw");
		type(confirm, "pw");
		submit.click();

		expect(await result).toEqual({
			name: "Alice",
			email: "alice@example.com",
			passphrase: "pw",
			publicKey: "keys/pub.asc",
			privateKey: "keys/priv.asc",
		});
		expect(modal.isOpen__).toBe(false);
		expect(document.body.contains(modal.containerEl)).toBe(false);
		expect(modal.contentEl.childElementCount).toBe(0);
	});

	test("Submit without touching the form resolves the defaults with an empty passphrase", async () => {
		const { result, submit } = open();
		submit.click();

		expect(await result).toEqual({
			name: "Obsidian Key Pair",
			email: "obsidian@example.com",
			passphrase: "",
			publicKey: "public.asc",
			privateKey: "private.asc",
		});
	});

	test("Cancel rejects and closes", async () => {
		const { modal, result, cancel } = open();

		cancel.click();

		await expect(result).rejects.toThrow("The generation of a new key pair was aborted!");
		expect(modal.isOpen__).toBe(false);
	});

	test("close() (ESC / backdrop) rejects with the same error", async () => {
		const { modal, result } = open();

		modal.close();

		await expect(result).rejects.toThrow("The generation of a new key pair was aborted!");
		expect(modal.isOpen__).toBe(false);
	});
});
