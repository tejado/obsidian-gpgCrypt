import { ButtonComponent, Setting, TextComponent } from "obsidian"
import { IValidator } from "../validators/IValidator";
import { ErrorTextInput } from "./ErrorTextInput";

export class InputListSetting extends Setting {

	public readonly inputListContainerEl: HTMLElement;
	public readonly outerSettingEl: HTMLElement;

	constructor(containerEl: HTMLElement) {
		super(containerEl);
		this.outerSettingEl = containerEl.createDiv({ cls: 'setting-item column setting-list-item' });
		this.settingEl.classList.add('inputlist-container', 'flex')
		this.settingEl.classList.remove('setting-item');
		this.outerSettingEl.append(this.settingEl);
		this.inputListContainerEl = this.outerSettingEl.createDiv({ cls: 'flex column list-input' })
	}


	/**
	* @name addInput
	* @description Wrapper function that 
	* @returns {@InputListSetting} this
	*/
	public addInput(callback: (text: ErrorTextInput) => void, onRemove?: () => void): InputListSetting {

		const inputContainer = this.inputListContainerEl.createDiv({ cls: 'flex input-gap' })

		const textElement = new ErrorTextInput(inputContainer);
		callback(textElement);
		const buttonElement = new ButtonComponent(inputContainer).setButtonText("Remove");

		buttonElement.onClick(() => {
			onRemove?.()
			//delete textelement on change setting.
			textElement.destory();
			buttonElement.buttonEl.remove();
		})

		return this;
	}

}
