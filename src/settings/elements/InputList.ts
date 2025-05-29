import { Setting, TextComponent } from "obsidian"

export class InputListSetting extends Setting {

	private readonly inputContainerEl: HTMLElement;

	constructor(containerEl: HTMLElement) {
		super(containerEl);
		this.inputContainerEl = containerEl.createDiv({ cls: 'flex column' })
	}


	public addInput(callback: (text: TextComponent) => void): Setting {

		const textElement = new TextComponent(this.inputContainerEl);
		callback(textElement);

		return this;
	}

}
