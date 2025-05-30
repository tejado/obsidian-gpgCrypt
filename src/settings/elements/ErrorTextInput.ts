import { TextComponent } from "obsidian";
import { ValidationError } from "../validators/IValidator";

export class ErrorTextInput extends TextComponent {


	private readonly inputContainer: HTMLElement;
	private readonly errorTextComponent: HTMLElement;

	constructor(containerEl: HTMLElement) {
		super(containerEl);
		this.inputContainer = containerEl.createDiv({ cls: 'errorful-input-container' });
		this.inputContainer.append(this.inputEl);
		this.errorTextComponent = this.inputContainer.createSpan({ cls: 'error-text mod-warning' })
	}

	private createErrorElement(error: ValidationError) {
		this.errorTextComponent.setText(error.displayError);
	}

	public throwError(error: ValidationError) {
		this.inputEl.classList.add('error');
		this.createErrorElement(error);
	}

	public clearError() {
		this.errorTextComponent?.setText("");
		this.inputEl.classList.remove('error');
	}

	public destory() {
		this.inputEl.remove();
		this.inputContainer.remove()
		this.errorTextComponent.remove();
	}

}

