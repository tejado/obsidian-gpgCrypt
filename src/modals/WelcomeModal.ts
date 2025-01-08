import { App, Modal, ButtonComponent, Platform } from "obsidian";

export default class WelcomeModal extends Modal {

	private firstLoad: boolean;
	private resolve: ((value: string) => void);

	constructor(app: App, firstLoad: boolean) {
		super(app);
        
		this.firstLoad = firstLoad;
	}

	openAndAwait(){
		return new Promise<string>((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}

	onOpen() {
		const { contentEl } = this;

		const appendTxt = (parent: HTMLElement, text: string, tag: keyof HTMLElementTagNameMap | null = null) => {
			if (tag) {
				return parent.createEl(tag, { text: text });
			} else {
				parent.appendText(text);
				return parent;
			}
		};

		appendTxt(contentEl, "Welcome to gpgCrypt 🔒", "h2");
		appendTxt(contentEl, "gpgCrypt encrypts your notes effortlessly and seamlessly using GnuPG. All Obsidian functions can be used as usual, without reduced Markdown experience.", "p");
		appendTxt(contentEl, "Key pair!", "h4");
		appendTxt(contentEl, "To encrypt and decrypt your notes, gpgCrypt requires a key pair: a public key for encryption and a private key for decryption. If you opt for added security, you can use a passphrase-protected private key.", "p");

		const paragraph = appendTxt(contentEl, "Generate a new key pair", "p");
		appendTxt(paragraph, " OR ", "strong");
		appendTxt(paragraph, "follow the instructions if you already have a key pair you'd like to use:")
      
		// Instructions for adding existing key
		const instructions = contentEl.createEl("ol");
		appendTxt(instructions, "Place your key pair in your Obsidian Vault. The keys should be in ASCII format with a .asc extension. For example, public.asc and private.asc.", "li");
		appendTxt(instructions, "Go to the gpgCrypt plugin settings in Obsidian.", "li");
		appendTxt(instructions, "Under 'Public key' and 'Private key', set the paths to your key files relative to your Obsidian Vault.", "li");

		if (Platform.isMobile) {
			appendTxt(contentEl, "Please note that GnuPG CLI Wrapper is not supported on mobile devices.", "p");
		} else {
			appendTxt(contentEl, "Should you prefer using your local GnuPG CLI installation, for instance to integrate an OpenPGP Smartcard like Yubikey, configure this option in the plugin settings.", "p");
		}

		appendTxt(contentEl, "How to encrypt your notes", "h4");
		appendTxt(contentEl, "Encryption must be performed individually for each note. Navigate to the note's context menu and choose 'Encrypt with key pair'.", "p");
       
		const learnMore = appendTxt(contentEl, "Learn more at ", "p");
		const learnMoreLink = appendTxt(learnMore, "github.com/tejado/obsidian-gpgCrypt", "a");
		learnMoreLink.setAttribute("href", "https://github.com/tejado/obsidian-gpgCrypt");
		learnMoreLink.setAttribute("target", "_blank");
    
		const buttonContainer = contentEl.createDiv({cls: "modal-button-container"})

		new ButtonComponent(buttonContainer)
			.setButtonText("Generate new key pair...")
			.setCta()
			.onClick(() => {
				this.resolve("gen-key")
				this.close();
			});

		if(this.firstLoad === true) {
			new ButtonComponent(buttonContainer)
				.setButtonText("Open settings to use existing key pair...")
				.setCta()
				.onClick(() => {
					this.resolve("open-settings")
					this.close();
				});
        
			new ButtonComponent(buttonContainer)
				.setButtonText("Skip configuration")
				.onClick(() => {
					this.close();
				});
		} else {
			new ButtonComponent(buttonContainer)
				.setButtonText("Close")
				.onClick(() => {
					this.close();
				});
		}
	}

	close() {
		this.resolve("");
		super.close();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}