/**
 * ErrorTextInput (src/settings/elements/ErrorTextInput.ts) — a TextComponent wrapped in
 * `.errorful-input-container` with an inline `.error-text` span driven by ValidationError.
 */
import { describe, expect, test } from "vitest";
import { TextComponent } from "obsidian";
import { ErrorTextInput } from "src/settings/elements/ErrorTextInput";
import { ValidationError } from "src/settings/validators/IValidator";

function mount() {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const input = new ErrorTextInput(host);
	const container = host.querySelector<HTMLElement>(".errorful-input-container")!;
	const errorText = host.querySelector<HTMLElement>(".error-text")!;
	return { host, input, container, errorText };
}

describe("ErrorTextInput DOM", () => {
	test("is a TextComponent whose input lives inside .errorful-input-container next to an empty error span", () => {
		const { host, input, container, errorText } = mount();

		expect(input).toBeInstanceOf(TextComponent);
		expect(container).not.toBeNull();
		expect(container.contains(input.inputEl)).toBe(true);
		expect(input.inputEl.type).toBe("text");
		expect(errorText.classList.contains("mod-warning")).toBe(true);
		expect(errorText.parentElement).toBe(container);
		expect(errorText.textContent).toBe("");
		// the input was moved: nothing else remains directly under the host
		expect(Array.from(host.children)).toEqual([container]);
	});

	test("throwError shows the displayError and marks the input", () => {
		const { input, errorText } = mount();

		input.throwError(new ValidationError("Folder", "This Folder doesn't seem to exist in your Obsidian Vault", "x - file-not-found"));

		expect(errorText.textContent).toBe("This Folder doesn't seem to exist in your Obsidian Vault");
		expect(input.inputEl.classList.contains("error")).toBe(true);
	});

	test("clearError removes the text and the error class", () => {
		const { input, errorText } = mount();
		input.throwError(new ValidationError("Folder", "nope", "nope"));

		input.clearError();

		expect(errorText.textContent).toBe("");
		expect(input.inputEl.classList.contains("error")).toBe(false);
	});

	test("clearError on a pristine input is a no-op", () => {
		const { input, errorText } = mount();
		expect(() => input.clearError()).not.toThrow();
		expect(errorText.textContent).toBe("");
		expect(input.inputEl.classList.contains("error")).toBe(false);
	});

	test("a later throwError replaces the previous message", () => {
		const { input, errorText } = mount();
		input.throwError(new ValidationError("Folder", "first", "first"));
		input.throwError(new ValidationError("Folder", "second", "second"));
		expect(errorText.textContent).toBe("second");
	});

	test("destory() removes input, container and error span from the DOM", () => {
		const { host, input, container, errorText } = mount();

		input.destory();

		expect(host.contains(input.inputEl)).toBe(false);
		expect(container.isConnected).toBe(false);
		expect(errorText.isConnected).toBe(false);
		expect(host.childElementCount).toBe(0);
	});

	test("still behaves like a TextComponent (setValue / onChange on input events)", () => {
		const { input } = mount();
		const seen: string[] = [];
		input.setValue("initial").onChange((v) => seen.push(v));
		expect(input.getValue()).toBe("initial");
		expect(seen).toEqual([]); // setValue does not fire onChange

		input.inputEl.value = "typed";
		input.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
		expect(seen).toEqual(["typed"]);
	});
});
