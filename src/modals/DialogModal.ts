import { Modal, App } from "obsidian";

export default class DialogModal extends Modal {
	private resolve: ((value: boolean | PromiseLike<boolean>) => void);

	private paragraph: string;
	private additionalParagraph: string | undefined;
	private yesNo = true;

	constructor(app: App) {
		super(app);
	}

	openAndAwait(question: string, additionalParagraph?: string, yesNo?: boolean) {
		this.paragraph = question;
		this.additionalParagraph = additionalParagraph;
		this.yesNo = (yesNo === false) ? false : true;
        
		return new Promise<boolean>((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createDiv({ cls: "modal-title", text: "Confirm" });
        
		const contentContainer = contentEl.createDiv("modal-content");
		contentContainer.createEl("p", { text: this.paragraph });

		if(this.additionalParagraph) {
			contentContainer.createEl("p", { text: this.additionalParagraph });
		}

		// Button container
		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" })

		if (this.yesNo) {
			// Yes button
			const yesButton = buttonContainer.createEl("button", { text: "Yes", cls: "mod-cta" });
			yesButton.onclick = () => {
				this.resolve(true);
				this.close();
			};

			// No button
			const noButton = buttonContainer.createEl("button", { text: "No" });
			noButton.onclick = () => {
				this.resolve(false);
				this.close();
			};
		} else {
			// Show only an Okay button
			const okButton = buttonContainer.createEl("button", { text: "Ok", cls: "mod-cta" });
			okButton.onclick = () => {
				this.resolve(true);
				this.close();
			};
		}
	}

	close() {
		this.resolve(false);
		super.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}