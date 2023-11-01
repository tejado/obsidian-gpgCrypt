import { App, Notice, PluginSettingTab, Setting, TextComponent, normalizePath } from "obsidian";
import { FileRecovery, FileRecoveryDescription, Settings } from "./Settings";
import GpgPlugin from "../main";
import DialogModal from "../modals/DialogModal";

import { Backend, BackendDescription } from "src/backend/Backend";
import { CliPathStatus, GPGStatusMessage } from "../backend/wrapper/BackendWrapper";
import { BackendPassphraseCache } from "src/backend/BackendPassphraseCache";

export class SettingsTab extends PluginSettingTab {
	app: App;
	plugin: GpgPlugin;
	settings: Settings;
	containerEl: HTMLElement;

	private nativePublicKeySetting: Setting;
	private nativePrivateKeySetting: Setting;
	private executableSetting: Setting;
	private trustModelSetting: Setting;
	private compressionSetting: Setting;
	private recipientSetting: Setting;

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
        
		new Setting(this.containerEl)
			.setName("Remember passphrase")
			.setDesc("Duration (in seconds) for which Obsidian remembers your passphrase before prompting again. Set to 0 to disable.")
			.addText(text => {
				text.setValue(this.settings.passphraseTimeout.toString())
					.onChange(async (value) => {
						const valueNumber = Number(value);

						if (BackendPassphraseCache.isValidTimeout(valueNumber)) {
							this.plugin.cache.setTimeout(valueNumber);

							this.settings.passphraseTimeout = valueNumber;
							await this.plugin.saveSettings();
							await this.plugin.loadKeypair();
						} else {
							text.setValue(this.settings.passphraseTimeout.toString() || Number(300).toString());
						}
					});
			});

		new Setting(this.containerEl)
			.setName("Which encryption backend do you prefer?")
			.setDesc("Native OpenPGP.js or gpg cli wrapper (supports smartcards).")
			.addDropdown(dropdown => {
				dropdown
					.addOption(Backend.NATIVE, BackendDescription[Backend.NATIVE])
					.addOption(Backend.WRAPPER, BackendDescription[Backend.WRAPPER])
					.setValue(this.settings.backend)
					.onChange(async value => {
						this.settings.backend = value;
						await this.plugin.saveSettings();

						this.refreshBackendSettings();
					});
			});


		// OpenPGP.js (native) Settings
		this.nativePublicKeySetting = new Setting(this.containerEl)
			.setName("Public key")
			.setDesc("Path to your public key file.")
			.addButton(button => {
				button.setButtonText("Generate new key pair")
					.onClick(async() =>  {
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

		this.compressionSetting  = new Setting(this.containerEl)
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

		this.recipientSetting = new Setting(this.containerEl)
			.setName(this.SETTING_RECIPIENT_NAME)
			.setDesc(this.SETTING_RECIPIENT_DESC)
			.addDropdown(dropdown => {
				dropdown.addOption("loading", "Loading keys...")
					.setValue("loading")
					.setDisabled(true);
			});


		this.refreshBackendSettings();
	}

	private refreshBackendSettings() {
		if (this.settings.backend === Backend.WRAPPER) {
			this.nativePublicKeySetting.settingEl.hide();
			this.nativePrivateKeySetting.settingEl.hide();
			this.executableSetting.settingEl.show();
			this.trustModelSetting.settingEl.show();
			this.compressionSetting.settingEl.show();
			this.recipientSetting.settingEl.show();

			this.checkGpgExecutable(this.settings.backendWrapper.executable);
			this.refreshRecipientSetting();
		} else {
			this.nativePublicKeySetting.settingEl.show();
			this.nativePrivateKeySetting.settingEl.show();
			this.executableSetting.settingEl.hide();
			this.trustModelSetting.settingEl.hide();
			this.compressionSetting.settingEl.hide();
			this.recipientSetting.settingEl.hide();
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

		if(status === CliPathStatus.FOUND) {
			execSettingStatus.addClass("mod-success");
		} else {
			execSettingStatus.addClass("mod-warning");
		}
	}

	// check if the gpg executable is working or not
	private async checkGpgExecutable(path: string) {
		const result = await this.plugin.gpgWrapper.isGPG(path)
		
		this.setGpgExecDescription(result);
		if(result === CliPathStatus.FOUND) {
			this.plugin.gpgWrapper.setExecutable(path);
			this.settings.backendWrapper.executable = path;
			this.plugin.saveSettings();
		}
	}

	private async refreshRecipientSetting() {
		// Fetching public keys and updating the dropdown
		const keys = await this.plugin.gpgWrapper.getPublicKeys();

		// Remove initial recipient field
		this.recipientSetting.settingEl.remove();

		if (keys.length === 0) {
			new Notice("No keys found.");
			this.recipientSetting = new Setting(this.containerEl)
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

		this.recipientSetting = new Setting(this.containerEl)
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