import { App, Modal, Notice } from "obsidian";

export default class WrapperDecryptModal extends Modal {
	private cancel: () => void;
	private cancelBtn!: HTMLButtonElement;

	constructor(app: App, private fileName: string) {
		super(app);
	}

	onOpen() {
		this.containerEl.style.zIndex = "99999";

		const { contentEl } = this;

		// Remove the modal close button
		this.modalEl.querySelector(".modal-close-button")?.remove();

		// Remove modal-bg click listeners so that the modal can only be closed over buttons
		// The reason is UX: this is a blocking action in general and should not be clicked away unintentionally
		const oldBg = this.containerEl.querySelector(".modal-bg");
		if (oldBg) {
			const newBg = oldBg.cloneNode(true) as HTMLElement;
			oldBg.parentNode?.replaceChild(newBg, oldBg);
		}

		const appendTxt = (parent: HTMLElement, text: string, tag: keyof HTMLElementTagNameMap | null = null) => {
			if (tag) {
				return parent.createEl(tag, { text: text });
			} else {
				parent.appendText(text);
				return parent;
			}
		};

		this.titleEl.setText("Decryption in progress...");

		const paragraph = appendTxt(contentEl, "GnuPG CLI is running in the background to decrypt file ", "p");
		appendTxt(paragraph, `"${this.fileName}".`, "strong");

		const instructions = contentEl.createEl("ul");
		const actionNeeded = instructions.createEl("li");
		appendTxt(actionNeeded, "Action Needed: ", "strong");
		appendTxt(actionNeeded, "If prompted, enter your PIN or interact with your smartcard ");
		appendTxt(actionNeeded, "only in prompts you trust and expect.", "strong").addClass("mod-warning");
		const noPrompt = instructions.createEl("li");
		appendTxt(noPrompt, "No Prompt? ", "strong");
		appendTxt(noPrompt, "If decryption does not proceed, this might indicate a configuration issue. Please verify your GPG setup.");


		// Button container
		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" })

		// Cancel button (initially hidden)
		this.cancelBtn = buttonContainer.createEl("button", { text: "Cancel Decryption" });
		this.cancelBtn.style.display = "none";
		this.cancelBtn.addEventListener("click", () => {
			this.cancel();
			new Notice(`Decryption of "${this.fileName}" canceled.`);

			this.close();
		});

		const cancelButton = buttonContainer.createEl("button", { text: "Hide", cls: "mod-cta" });
		cancelButton.onclick = () => {
			this.close();
		};
	}

	public setOnCancelFn(cancelFn: () => void) {
		this.cancel = cancelFn;
		this.cancelBtn.style.display = "";
	}

	onClose() {
		this.contentEl.empty();
	}
}
