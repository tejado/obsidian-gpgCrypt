/**
 * InputListSetting (src/settings/elements/InputList.ts) — a Setting whose control area is followed by a
 * list of removable ErrorTextInputs (used for "Encrypt Folders"). Includes the F22 stale-index finding,
 * reproduced through the real SettingsTab.
 */
import { describe, expect, test, vi } from "vitest";
import { InputListSetting } from "src/settings/elements/InputList";
import { ErrorTextInput } from "src/settings/elements/ErrorTextInput";
import { mountSettingsTab, typeInto } from "./settings-tab-harness";

function mount() {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const setting = new InputListSetting(host);
	const outer = host.querySelector<HTMLElement>(".setting-list-item")!;
	const list = host.querySelector<HTMLElement>(".list-input")!;
	return { host, setting, outer, list };
}

describe("InputListSetting DOM", () => {
	test("wraps the setting in an outer .setting-item.column.setting-list-item with the list container", () => {
		const { host, setting, outer, list } = mount();

		expect(Array.from(host.children)).toEqual([outer]);
		expect(outer).toBe(setting.outerSettingEl);
		expect(outer.classList.contains("setting-item")).toBe(true);
		expect(outer.classList.contains("column")).toBe(true);
		expect(outer.classList.contains("setting-list-item")).toBe(true);

		// the original settingEl moved inside and became the flex header row
		expect(setting.settingEl.parentElement).toBe(outer);
		expect(setting.settingEl.classList.contains("inputlist-container")).toBe(true);
		expect(setting.settingEl.classList.contains("flex")).toBe(true);
		expect(setting.settingEl.classList.contains("setting-item")).toBe(false);

		expect(list).toBe(setting.inputListContainerEl);
		expect(list.parentElement).toBe(outer);
		expect(list.classList.contains("flex")).toBe(true);
		expect(list.classList.contains("column")).toBe(true);
		expect(Array.from(outer.children)).toEqual([setting.settingEl, list]);
	});

	test("setName / setDesc / addButton still render into the header row", () => {
		const { setting } = mount();
		setting.setName("Encrypt Folders").setDesc("desc").addButton((b) => b.setButtonText("Add Folder"));
		expect(setting.settingEl.querySelector(".setting-item-name")?.textContent).toBe("Encrypt Folders");
		expect(setting.settingEl.querySelector(".setting-item-description")?.textContent).toBe("desc");
		expect(setting.settingEl.querySelector("button")?.textContent).toBe("Add Folder");
	});

	test("addInput adds a row with an ErrorTextInput and a Remove button; callback receives the input", () => {
		const { setting, list } = mount();
		const received: ErrorTextInput[] = [];

		const returned = setting.addInput((text) => {
			received.push(text);
			text.setValue("secret");
		});

		expect(returned).toBe(setting);
		expect(received).toHaveLength(1);
		expect(received[0]).toBeInstanceOf(ErrorTextInput);

		const row = list.querySelector<HTMLElement>(".input-gap")!;
		expect(row.classList.contains("flex")).toBe(true);
		expect(row.parentElement).toBe(list);
		expect(row.querySelector(".errorful-input-container input")).toBe(received[0].inputEl);
		expect(row.querySelector<HTMLInputElement>("input")?.value).toBe("secret");
		expect(row.querySelector(".errorful-input-container .error-text.mod-warning")).not.toBeNull();
		expect(row.querySelector("button")?.textContent).toBe("Remove");
	});

	test("addInput appends rows in order", () => {
		const { setting, list } = mount();
		setting.addInput((t) => t.setValue("a")).addInput((t) => t.setValue("b"));
		expect(Array.from(list.querySelectorAll<HTMLInputElement>("input")).map((i) => i.value)).toEqual(["a", "b"]);
		expect(list.querySelectorAll(".input-gap")).toHaveLength(2);
	});

	test("Remove calls onRemove and removes input, error container and button", () => {
		const { setting, list } = mount();
		const onRemove = vi.fn();
		let text!: ErrorTextInput;
		setting.addInput((t) => (text = t), onRemove);
		const button = list.querySelector<HTMLButtonElement>("button")!;

		button.click();

		expect(onRemove).toHaveBeenCalledTimes(1);
		expect(list.querySelector("input")).toBeNull();
		expect(text.inputEl.isConnected).toBe(false);
		expect(list.querySelector(".errorful-input-container")).toBeNull();
		expect(list.querySelector("button")).toBeNull();
	});

	test("Remove without an onRemove callback does not throw", () => {
		const { setting, list } = mount();
		setting.addInput(() => undefined);
		expect(() => list.querySelector<HTMLButtonElement>("button")!.click()).not.toThrow();
		expect(list.querySelector("input")).toBeNull();
	});

	// F22 — the `.input-gap` row container is never removed; only its children are.
	test.fails("[F22] Remove also removes the empty row container", () => {
		const { setting, list } = mount();
		setting.addInput(() => undefined);
		list.querySelector<HTMLButtonElement>("button")!.click();
		expect(list.querySelectorAll(".input-gap")).toHaveLength(0);
	});
});

describe("Encrypt Folders list through the real SettingsTab", () => {
	// F22: every row captures its `idx` when created; after removing row 0
	// `foldersToEncrypt` shifts left but the remaining row still writes to index 1.
	test.fails("[F22] removing the first of two folder rows then editing the remaining row updates the correct index", () => {
		const m = mountSettingsTab({ folders: ["a", "b", "c"], settings: { foldersToEncrypt: ["a", "b"] } });
		const list = m.tab.containerEl.querySelector<HTMLElement>(".setting-list-item .list-input")!;
		const removeButtons = () => Array.from(list.querySelectorAll<HTMLButtonElement>("button")).filter((b) => b.textContent === "Remove");
		expect(list.querySelectorAll("input")).toHaveLength(2);

		removeButtons()[0].click();
		expect(m.settings.foldersToEncrypt).toEqual(["b"]);

		const remaining = list.querySelector<HTMLInputElement>("input")!;
		expect(remaining.value).toBe("b");
		typeInto(remaining, "c");

		expect(m.settings.foldersToEncrypt).toEqual(["c"]);
	});

	test("editing the LAST of two rows after removing the last row does not resurrect it", () => {
		// control case for F22: removing the last row leaves the first row's index valid
		const m = mountSettingsTab({ folders: ["a", "b", "c"], settings: { foldersToEncrypt: ["a", "b"] } });
		const list = m.tab.containerEl.querySelector<HTMLElement>(".setting-list-item .list-input")!;
		const removeButtons = () => Array.from(list.querySelectorAll<HTMLButtonElement>("button")).filter((b) => b.textContent === "Remove");

		removeButtons()[1].click();
		expect(m.settings.foldersToEncrypt).toEqual(["a"]);

		typeInto(list.querySelector<HTMLInputElement>("input")!, "c");
		expect(m.settings.foldersToEncrypt).toEqual(["c"]);
	});
});
