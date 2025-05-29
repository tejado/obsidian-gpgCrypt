import { App, Notice, Platform, PluginSettingTab, Setting, TextComponent, normalizePath } from "obsidian";

import { FileRecovery, FileRecoveryDescription, Settings } from "./Settings";
import { Backend, BackendDescription } from "src/backend/Backend";
import { CliPathStatus, GPGStatusMessage } from "src/backend/wrapper/BackendWrapper";
import { BackendPassphraseCache } from "src/backend/BackendPassphraseCache";
import GpgPlugin from "src/main";
import DialogModal from "src/modals/DialogModal";
import WelcomeModal from "src/modals/WelcomeModal";
import { InputListSetting } from "./elements/InputList";
import { FolderValidator } from "./validators/ValidateFolderPath";
import { ValidationError } from "./validators/IValidator";
import { _log } from "src/common/utils";

export class SettingsTab extends PluginSettingTab {
	app: App;
	plugin: GpgPlugin;
	settings: Settings;
	containerEl: HTMLElement;

	// OpenPGP.js (native) Settings
	private nativePublicKeySetting: Setting;
	private nativePrivateKeySetting: Setting;
	private nativeAskPassphraseOnStartupSetting: Setting;
	private nativeRememberPassphraseSetting: Setting;
	private nativeResetPassphraseTimeoutOnWriteSetting: Setting;

	// Gpg CLI Wrapper (wrapper) Settings
	private executableSetting: Setting;
	private trustModelSetting: Setting;
	private compressionSetting: Setting;
	private recipientSetting: Setting;
	private cacheSetting: Setting;
	private showDecryptModalSetting: Setting;

	readonly SETTING_RECIPIENT_NAME = "Key ID / Recipient";
	readonly SETTING_RECIPIENT_DESC = "Select your GPG key which should be used for encryption.";

	constructor(app: App, plugin: GpgPlugin, settings: Settings) {
		super(app, plugin);

		this.app = app;
		this.plugin = plugin;
		this.settings = settings;
	}

	display(): void {
		this.containerEl.empty();

		let publicKeyInputField: TextComponent;
		let privateKeyInputField: TextComponent;

		new Setting(this.containerEl)
			.setName("Encrypt all notes")
			.setDesc("When enabled, each note will be encrypted upon its next modification.")
			.addToggle(toggle => {
				toggle.setTooltip("When enabled, each note will be encrypted upon its next modification.")
					.setValue(this.settings.encryptAll)
					.onChange(async (value) => {
						this.settings.encryptAll = value;
						await this.plugin.saveSettings();
					});
			});

		//TODO: disable this (gray it out) if `this.settings.encryptAll` is true

		const encryptFolders = new InputListSetting(this.containerEl)
			.setName("Encrypt Folders")
			.setDesc("TODO: Think of a description")
			.addButton((button => {
				button.setButtonText("Add Folder")
				button.onClick(() => {
					let idx = 0;
					if (this.settings.foldersToEncrypt) {
						idx = this.settings.foldersToEncrypt.length;
						this.settings.foldersToEncrypt.push("");
					} else {
						this.settings.foldersToEncrypt = [""];
					}
					addFolderToSetting("", idx);
				})
			}))

		const addFolderToSetting = (folder: string, idx: number) => {
			encryptFolders.addInput((text) => {
				text.setValue(folder);
				//TODO: add validation that the folder can be found in the directory
				text.onChange(async (value) => {
					const validator = new FolderValidator();
					try {
						validator.validate(value);
						this.settings.foldersToEncrypt[idx] = value;
						text.inputEl.classList.remove('error');
						await this.plugin.saveSettings();
					} catch (e) {
						if (e instanceof ValidationError) {
							_log(e.message);
							text.inputEl.classList.add('error');
						}
					}
				})
			}, async () => {
				this.settings.foldersToEncrypt = [
					...this.settings?.foldersToEncrypt?.slice(0, idx),
					...this.settings?.foldersToEncrypt?.slice(idx + 1)
				]
				await this.plugin.saveSettings();
			});
		};

		this.settings.foldersToEncrypt?.forEach((folder, idx) => {
			addFolderToSetting(folder, idx)
		})

		new Setting(this.containerEl)
			.setName("Use .gpg file extension")
			.setDesc("When enabled, encrypted notes will be renamed with a .gpg file extension. Permanent decryption will rename files to .md extension.")
			.addToggle(toggle => {
				toggle.setTooltip("When enabled, encrypted notes will be renamed with a .gpg file extension. Permanent decryption will rename files to .md extension.")
					.setValue(this.settings.renameToGpg)
					.onChange(async (value) => {
						this.settings.renameToGpg = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(this.containerEl)
			.setName("File recovery format for encrypted notes")
			.setDesc("The Obsidian Core Plugin 'File Recovery' stores notes on disk. Choose the storage format.")
			.addDropdown(dropdown => {
				dropdown
					.addOption(FileRecovery.ENCRYPTED, FileRecoveryDescription[FileRecovery.ENCRYPTED])
					.addOption(FileRecovery.PLAINTEXT, FileRecoveryDescription[FileRecovery.PLAINTEXT])
					.addOption(FileRecovery.SKIP, FileRecoveryDescription[FileRecovery.SKIP])
					.setValue(this.settings.fileRecovery)
					.onChange(async value => {
						this.settings.fileRecovery = value;
						await this.plugin.saveSettings();
					});
			});

		const compatibilityModeSetting = new Setting(this.containerEl)
			.setName("Compatibility mode")
			.setDesc("Enable this setting to use Obsidian's native metadata generation needed for features like link blocks and certain plugins (e.g., Excalidraw). ")
			.addToggle(toggle => {
				toggle.setTooltip("Enable this setting to use Obsidian's native metadata generation needed for features like link blocks and certain plugins (e.g., Excalidraw). Warning: this exposes plaintext headings and file structure on disk.")
					.setValue(this.settings.compatibilityMode)
					.onChange(async (value) => {
						this.settings.compatibilityMode = value;
						await this.plugin.saveSettings();
					});
			});

		const warningEl = compatibilityModeSetting.descEl.createSpan({ cls: 'mod-warning' });
		warningEl.innerText = "Warning: this exposes plaintext headings and file structure on disk.";


		new Setting(this.containerEl)
			.setHeading()
			.setName("Encryption Backend");

		if (Platform.isMobile) {
			new Setting(this.containerEl)
				.setName("Encryption backend")
				.setDesc("Only native OpenPGP.js is supported on mobile devices.")
				.addDropdown(dropdown => {
					dropdown
						.addOption(Backend.NATIVE, BackendDescription[Backend.NATIVE])
						.setValue(Backend.NATIVE)
						.setDisabled(true);
				});
		} else {
			new Setting(this.containerEl)
				.setName("Encryption backend")
				.setDesc("Native OpenPGP.js or GnuPG CLI Wrapper. The GnuPG CLI Wrapper is intended for advanced users, offering more configuration options and support for smartcards.")
				.addDropdown(dropdown => {
					dropdown
						.addOption(Backend.NATIVE, BackendDescription[Backend.NATIVE])
						.addOption(Backend.WRAPPER, BackendDescription[Backend.WRAPPER])
						.setValue(this.settings.backend)
						.onChange(async value => {
							this.settings.backend = value;
							this.refreshBackendSettings();

							await this.plugin.saveSettings();
						});
				});
		}


		// OpenPGP.js (native) Settings
		this.nativePublicKeySetting = new Setting(this.containerEl)
			.setName("Public key")
			.setDesc("Path to your public key file.")
			.addButton(button => {
				button.setButtonText("Generate new key pair...")
					.onClick(async () => {
						const success = await this.plugin.generateKeypair();

						if (success) {
							publicKeyInputField.setValue(this.settings.backendNative.publicKeyPath);
							privateKeyInputField.setValue(this.settings.backendNative.publicKeyPath);
						}
					});

				button.buttonEl.addClass("mod-cta");
			})
			.addText(text => {
				publicKeyInputField = text;
				text.setPlaceholder("pubkey.asc")
					.setValue(this.settings.backendNative.publicKeyPath)
					.onChange(async (value) => {
						this.settings.backendNative.publicKeyPath = normalizePath(value);
						await this.plugin.saveSettings();
						await this.plugin.loadKeypair();
					});
			});

		this.nativePrivateKeySetting = new Setting(this.containerEl)
			.setName("Private key")
			.setDesc("Path to your private key file.")
			.addText(text => {
				privateKeyInputField = text;
				text.setPlaceholder("privkey.asc")
					.setValue(this.settings.backendNative.privateKeyPath)
					.onChange(async (value) => {
						this.settings.backendNative.privateKeyPath = normalizePath(value);
						await this.plugin.saveSettings();
						await this.plugin.loadKeypair();
					});
			});

		this.nativeAskPassphraseOnStartupSetting = new Setting(this.containerEl)
			.setName("Ask passphrase on startup")
			.setDesc("When enabled, this setting will prompt for the passphrase for your private key during the Obsidian app startup. This works with the 'Remember Passphrase' setting, so you might be asked again depending on how long it's set to remember.")
			.addToggle(toggle => {
				toggle.setTooltip("When enabled, this setting will prompt for the passphrase for your private key during the Obsidian app startup. This works with the 'Remember Passphrase' setting, so you might be asked again depending on how long it's set to remember.")
					.setValue(this.settings.askPassphraseOnStartup)
					.onChange(async (value) => {
						this.settings.askPassphraseOnStartup = value;
						await this.plugin.saveSettings();
					});
			});

		this.nativeRememberPassphraseSetting = new Setting(this.containerEl)
			.setName("Remember passphrase")
			.setDesc("Duration (in seconds) for which Obsidian remembers your private key passphrase before prompting you again. Minimum: 10 seconds. If you close or restart the app, you'll need to enter your passphrase again.")
			.addText(text => {
				text.setValue(this.settings.passphraseTimeout.toString())
					.onChange(async (value) => {
						let valueNumber = Number(value);

						if (BackendPassphraseCache.isValidTimeout(valueNumber)) {
							if (valueNumber < 10) {
								valueNumber = 10;
							}

							this.plugin.cache.setTimeout(valueNumber);

							this.settings.passphraseTimeout = valueNumber;
							await this.plugin.saveSettings();
						} else {
							text.setValue(this.settings.passphraseTimeout.toString() || Number(300).toString());
						}
					});
			});

		this.nativeResetPassphraseTimeoutOnWriteSetting = new Setting(this.containerEl)
			.setName("Restart passphrase timeout on save")
			.setDesc("When enabled, the countdown for how long your passphrase is remembered will restart every time an encrypted note is saved, preventing frequent re-entry that may occur with some other plugins.")
			.addToggle(toggle => {
				toggle.setTooltip("When enabled, the countdown for how long your passphrase is remembered will restart every time an encrypted note is saved, preventing frequent re-entry that may occur with some other plugins.")
					.setValue(this.settings.resetPassphraseTimeoutOnWrite)
					.onChange(async (value) => {
						this.settings.resetPassphraseTimeoutOnWrite = value;
						await this.plugin.saveSettings();
					});
			});


		// Gpg CLI Wrapper (wrapper) Settings
		this.executableSetting = new Setting(this.containerEl)
			.setName("GPG executable")
			.setDesc("Path to GPG executable.")
			.addText(text => {
				text.setPlaceholder("gpg")
					.setValue(this.settings.backendWrapper.executable)
					.onChange(async (path) => {
						this.checkGpgExecutable(path);
					});
			});

		this.trustModelSetting = new Setting(this.containerEl)
			.setName("Always trust keys")
			.setDesc("Use \"--trust-model always\" to trust all keys independent of the key trust.")
			.addToggle(toggle => {
				toggle.setTooltip("Use \"--trust-model always\" to trust all keys independent of the key trust.")
					.setValue(this.settings.backendWrapper.trustModelAlways)
					.onChange(async (value) => {
						this.settings.backendWrapper.trustModelAlways = value;
						await this.plugin.saveSettings();
					});
			});

		this.compressionSetting = new Setting(this.containerEl)
			.setName("Use compression")
			.setDesc("When disabled then \"--compression-algo none\" is set.")
			.addToggle(toggle => {
				toggle.setTooltip("If disabled then \"--compression-algo none\" is set.")
					.setValue(this.settings.backendWrapper.compression)
					.onChange(async (value) => {
						this.settings.backendWrapper.compression = value;
						await this.plugin.saveSettings();
					});
			});

		this.cacheSetting = new Setting(this.containerEl)
			.setName("Cache decrypted notes")
			.setDesc("When enabled, decrypted notes are temporarily stored in memory, allowing them to reopen faster if they remain unchanged.")
			.addToggle(toggle => {
				toggle.setTooltip("When enabled, decrypted notes are temporarily stored in memory, allowing them to reopen faster if they remain unchanged.")
					.setValue(this.settings.backendWrapper.cache)
					.onChange(async (value) => {
						this.settings.backendWrapper.cache = value;
						await this.plugin.saveSettings();
					});
			});

		this.recipientSetting = new Setting(this.containerEl)
			.setName(this.SETTING_RECIPIENT_NAME)
			.setDesc(this.SETTING_RECIPIENT_DESC)
			.addDropdown(dropdown => {
				dropdown.addOption("loading", "Loading keys...")
					.setValue("loading")
					.setDisabled(true);
			});

		this.showDecryptModalSetting = new Setting(this.containerEl)
			.setName("Show decryption dialog")
			.setDesc("When enabled, a 'Decryption in progress' dialog appears while your note is being decrypted using GnuPG CLI.")
			.addToggle(toggle => {
				toggle.setTooltip("When enabled, a 'Decryption in progress' dialog appears while your file is being decrypted using GnuPG CLI.")
					.setValue(this.settings.backendWrapper.showDecryptModal)
					.onChange(async (value) => {
						this.settings.backendWrapper.showDecryptModal = value;
						await this.plugin.saveSettings();
					});
			});

		// build common settings
		new Setting(this.containerEl)
			.setHeading()
			.setName("About");

		new Setting(this.containerEl)
			.setName("Show welcome dialog")
			.setDesc("Open the welcome dialog to understand how to set up your keys.")
			.addButton(button => {
				button.setButtonText("Open welcome dialog...")
					.setCta()
					.onClick(async () => {
						const action = await new WelcomeModal(this.app, false).openAndAwait();

						if (action === "gen-key") {
							const success = await this.plugin.generateKeypair();

							if (success) {
								publicKeyInputField.setValue(this.settings.backendNative.publicKeyPath);
								privateKeyInputField.setValue(this.settings.backendNative.publicKeyPath);
							}
						}
					});
			});

		const learnMoreSetting = new Setting(this.containerEl)
			.setName("Learn more")
			.setDesc("https://github.com/tejado/obsidian-gpgCrypt");

		// Manually add a clickable link to the setting description
		const descEl = learnMoreSetting.descEl;
		descEl.empty();
		const anchor = descEl.createEl("a", {
			text: "https://github.com/tejado/obsidian-gpgCrypt",
			href: "https://github.com/tejado/obsidian-gpgCrypt"
		});
		anchor.setAttribute("target", "_blank");

		this.refreshBackendSettings();
	}

	private refreshBackendSettings() {
		if (this.settings.backend === Backend.WRAPPER) {
			this.nativePublicKeySetting.settingEl.hide();
			this.nativePrivateKeySetting.settingEl.hide();
			this.nativeAskPassphraseOnStartupSetting.settingEl.hide();
			this.nativeRememberPassphraseSetting.settingEl.hide();
			this.nativeResetPassphraseTimeoutOnWriteSetting.settingEl.hide();
			this.executableSetting.settingEl.show();
			this.trustModelSetting.settingEl.show();
			this.compressionSetting.settingEl.show();
			this.recipientSetting.settingEl.show();
			this.cacheSetting.settingEl.show();
			this.showDecryptModalSetting.settingEl.show();

			this.checkGpgExecutable(this.settings.backendWrapper.executable);
			this.refreshRecipientSetting();
		} else {
			this.nativePublicKeySetting.settingEl.show();
			this.nativePrivateKeySetting.settingEl.show();
			this.nativeAskPassphraseOnStartupSetting.settingEl.show();
			this.nativeRememberPassphraseSetting.settingEl.show();
			this.nativeResetPassphraseTimeoutOnWriteSetting.settingEl.show();
			this.executableSetting.settingEl.hide();
			this.trustModelSetting.settingEl.hide();
			this.compressionSetting.settingEl.hide();
			this.recipientSetting.settingEl.hide();
			this.cacheSetting.settingEl.hide();
			this.showDecryptModalSetting.settingEl.hide();

			this.settings.backendWrapper.cache = false;
		}
	}

	private setGpgExecDescription(status: CliPathStatus) {
		let message = "Loading..."
		message = GPGStatusMessage.getFriendlyMessage(status);

		while (this.executableSetting.descEl.firstChild) {
			this.executableSetting.descEl.removeChild(this.executableSetting.descEl.firstChild);
		}

		const execSettingDescription = this.executableSetting.descEl.createDiv();
		execSettingDescription.setText("Path to GPG executable.");

		const execSettingStatus = this.executableSetting.descEl.createDiv();
		execSettingStatus.setText(`Status: ${message}`);

		if (status === CliPathStatus.FOUND) {
			execSettingStatus.addClass("mod-success");
		} else {
			execSettingStatus.addClass("mod-warning");
		}
	}

	// check if the gpg executable is working or not
	private async checkGpgExecutable(path: string) {
		const result = await this.plugin.gpgWrapper.isGPG(path)

		this.setGpgExecDescription(result);
		if (result === CliPathStatus.FOUND) {
			this.plugin.gpgWrapper.setExecutable(path);
			this.settings.backendWrapper.executable = path;
			this.plugin.saveSettings();
		}
	}

	private async refreshRecipientSetting() {
		// Fetching public keys and updating the dropdown
		const keys = await this.plugin.gpgWrapper.getPublicKeys();

		// Clear recipient field
		this.recipientSetting.clear();

		if (keys.length === 0) {
			new Notice("No keys found.");
			this.recipientSetting
				.setName(this.SETTING_RECIPIENT_NAME)
				.setClass("mod-warning")
				.setDesc(this.SETTING_RECIPIENT_DESC)
				.addDropdown(dropdown => {
					dropdown.addOption("nokeys", "No keys found");
					dropdown.setValue("nokeys");
					dropdown.setDisabled(true);
				});

			return;
		}

		this.recipientSetting
			.setName(this.SETTING_RECIPIENT_NAME)
			.setDesc(this.SETTING_RECIPIENT_DESC)
			.addDropdown(dropdown => {
				keys.forEach((key) => {
					dropdown.addOption(key.keyID, `${key.userID} (${key.keyID})`);
				});

				dropdown
					.setValue(this.settings.backendWrapper.recipient)
					.onChange(async value => {

						try {
							const confirmChange = await new DialogModal(this.app).openAndAwait(
								"When you change the key, existing notes remains encrypted with the old key. The new key will only be applied to future note changes. However, to access notes encrypted with the old key, the old key is necessary for decryption.",
								"Are you sure you want to proceed with this change?"
							);

							if (confirmChange) {
								this.settings.backendWrapper.recipient = value;
								await this.plugin.saveSettings();
							} else {
								dropdown.setValue(this.settings.backendWrapper.recipient);
							}
						} catch (error) {
							// windows was closed without a selection so nothing changes
							dropdown.setValue(this.settings.backendWrapper.recipient);
							return;
						}
					});

			});
	}
}
