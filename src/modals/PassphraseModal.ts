import { App, Modal } from "obsidian";

export default class PassphraseModal extends Modal {
	private passphraseInput: HTMLInputElement;
	private resolve: ((value: string) => void);
	private reject: ((reason?: Error) => void);

	private additionalDescription: string | undefined;

	constructor(app: App) {
		super(app);
	}
    
	openAndAwait(additionalDescription?: string){
		this.additionalDescription = additionalDescription;
		this.containerEl.style.zIndex = "10001";

		return new Promise<string>((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;

			this.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;

		contentEl.createDiv({ cls: "modal-title", text: `Enter passphrase${this.additionalDescription}` });

		const contentContainer = contentEl.createDiv("modal-content");

		this.passphraseInput = contentContainer.createEl("input", {
			type: "password",
			placeholder: `Enter your passphrase${this.additionalDescription}...`,
			attr: { style: "width: 100%;" }
		});

		
		// Button container
		const buttonContainer = contentEl.createDiv({cls: "modal-button-container"})

		const submitButton = buttonContainer.createEl("button", {text: "Submit", cls: "mod-cta"});
		submitButton.onclick = () => {
			this.resolve(this.passphraseInput.value);
			this.close();
		};

		const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
		cancelButton.onclick = () => {
			this.reject(new Error(`No passphrase${this.additionalDescription} provided!`));
			this.close();
		};

		this.passphraseInput.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && this.passphraseInput.value) {
				submitButton.click();
			}
		});
	}

	close() {
		if (this.reject) {
			this.reject(new Error(`No passphrase${this.additionalDescription} provided!`));
		}
		super.close();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}