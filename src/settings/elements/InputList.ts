import { ButtonComponent, Setting, TextComponent } from "obsidian"

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
	*/
	public addInput(callback: (text: TextComponent, onRemove?: () => void) => void): InputListSetting {

		const inputContainer = this.inputListContainerEl.createDiv({ cls: 'flex input-gap' })

		const textElement = new TextComponent(inputContainer);
		callback(textElement);
		const buttonElement = new ButtonComponent(inputContainer).setButtonText("Remove");

		buttonElement.onClick(() => {
			//delete textelement on change setting.
			textElement.setValue("");
			textElement.inputEl.remove();
			buttonElement.buttonEl.remove();
		})

		return this;
	}

}
