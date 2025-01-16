import { App, Modal, MarkdownView } from "obsidian";

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

		// Obsidian has a short state-change delay when switching from one note
		// to another. In that time it is possible to edit one note that is getting
		// written to the other one. To avoid it, the following code removes the
		// focus of the active view in case the passphrase modal gets opened.
		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (mdView) {
			mdView.editor.blur();
		}

		return new Promise<string>((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;

			this.open();
		});
	}

	onOpen(): void {
		// Show modal even when Obsidian is on loading screen
		this.containerEl.style.zIndex = "99999";

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
			console.log("press enter");
			if (event.key === "Enter" && this.passphraseInput.value) {
				submitButton.click();
				
				event.preventDefault();
				event.stopPropagation();
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