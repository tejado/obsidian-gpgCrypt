import { App, Modal, normalizePath } from "obsidian";

export default class GenerateKeypairModal extends Modal {

	private resolve: (value: { name: string, email: string, passphrase: string; publicKey: string; privateKey: string }) => void;
	private reject: ((reason?: Error) => void);

	constructor(app: App) {
		super(app);
	}
	
	openAndAwait(){
		return new Promise<{ name: string, email: string, passphrase: string; publicKey: string; privateKey: string }>((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;

			this.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;

		contentEl.createDiv({ cls: "modal-title", text: "Generate new key pair" });

		const contentContainer = contentEl.createDiv("modal-content");
		contentContainer.createEl("p", { text: "Generate a new key pair with gpgCrypt and store it in your Obsidian Vault! In the event of losing either the key pair or the passphrase, anything encrypted by it will become inaccessible." });

		const createSetting = (name: string, description: string, inputType: string, defaultValue?: string) => {
			const settingItem = contentContainer.createDiv("setting-item");

			const infoDiv = settingItem.createDiv("setting-item-info");
			infoDiv.createDiv("setting-item-name").setText(name);			
			const descDiv = infoDiv.createDiv("setting-item-description");
			descDiv.setText(description);

			const controlDiv = settingItem.createDiv("setting-item-control");
			const inputEl = controlDiv.createEl("input", { type: inputType });
			if (defaultValue) inputEl.setAttribute("value", defaultValue);

			return { inputEl, descDiv };
		};

		const nameInput = createSetting("Name", "Identifier that personalizes the new key pair for easier recognition and key management (optional).", "text", "Obsidian Key Pair");
		const emailInput = createSetting("E-mail address", "Identifier that personalizes the new key pair for easier recognition and key management (optional).", "text", "obsidian@example.com");
		const publicKeyInput = createSetting("Public key name", "File name of the new public key which will be stored in your Obsidian Vault.", "text", "public.asc");
		const privateKeyInput = createSetting("Private key name", "File name of the new private key which will be stored in your Obsidian Vault.", "text", "private.asc");
		const passphraseInput = createSetting("Passphrase", "Enter the passphrase to protect the private key.", "password");
		const { inputEl: confirmPassphraseInput, descDiv: confirmPassphraseDesc } = createSetting("Confirm passphrase", "Confirm the passphrase.", "password");

		// Button container
		const buttonContainer = contentEl.createDiv({cls: "modal-button-container"})

		const submitButton = buttonContainer.createEl("button", { text: "Generate Key Pair", cls: "mod-cta" });
		submitButton.onclick = () => {
			this.resolve({
				name: nameInput.inputEl.value,
				email: emailInput.inputEl.value,
				passphrase: passphraseInput.inputEl.value,
				publicKey: normalizePath(publicKeyInput.inputEl.value),
				privateKey: normalizePath(privateKeyInput.inputEl.value)
			});
			this.close();
		};

		const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
		cancelButton.onclick = () => {
			this.reject(new Error("The generation of a new key pair was aborted!"));
			this.close();
		};
		
		const updatePassphraseIndicator = () => {
			if (passphraseInput.inputEl.value !== confirmPassphraseInput.value) {
				confirmPassphraseDesc.setText("Confirm the passphrase. Passphrases are different.");
				confirmPassphraseDesc.addClass("mod-warning");
				confirmPassphraseDesc.removeClass("mod-success");
				submitButton.setAttribute("disabled", "true");
			} else {
				confirmPassphraseDesc.style.color = "green";
				confirmPassphraseDesc.setText("Confirm the passphrase. Passphrases are the same.");
				confirmPassphraseDesc.removeClass("mod-warning");
				confirmPassphraseDesc.addClass("mod-success");
				submitButton.removeAttribute("disabled");
			}
		};
		
		passphraseInput.inputEl.addEventListener("input", updatePassphraseIndicator);
		confirmPassphraseInput.addEventListener("input", updatePassphraseIndicator);
	}

	close() {
		if (this.reject) {
			this.reject(new Error("The generation of a new key pair was aborted!"));
		}
		super.close();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}