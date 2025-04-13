import { Notice, Platform, Plugin, DataWriteOptions, TFile, normalizePath, setIcon } from "obsidian";

import { FileRecovery, Settings } from "./settings/Settings";
import { SettingsTab } from "./settings/SettingsTab";
import { Backend } from "./backend/Backend";
import { BackendNative } from "./backend/native/BackendNative";
import { BackendWrapper } from "./backend/wrapper/BackendWrapper"
import { BackendPassphraseCache } from "./backend/BackendPassphraseCache";
import { _log, changeFileExtGpgToMd, changeFileExtMdToGpg, isGpgKey } from "./common/utils";
import DialogModal from "./modals/DialogModal";
import PassphraseModal from "./modals/PassphraseModal";
import GenerateKeypairModal from "./modals/GenerateKeypairModal";
import WelcomeModal from "./modals/WelcomeModal";
import WrapperDecryptModal from "./modals/WrapperDecryptModal";


// The duration of Notice alerts in milliseconds
const NOTICE_DURATION_MS = 10000;


export default class GpgPlugin extends Plugin {
	private settings: Settings;

	public gpgNative: BackendNative
	public gpgWrapper: BackendWrapper
	public cache: BackendPassphraseCache;

	// Save file state (encrypted or not) to check for any
	// inconsistencies between this and the file on disk
	private encryptedFileStatus = new Map<string, boolean>();

	private statusBarFileState: HTMLElement;

	// Stores decrypt promise per encrypted text to avoid 
	// 1. re-execution of GPG exec 
	// 2. multiple Notices
	// when Obisidan is doing multiple async read calls
	private decryptionCache = new Map<string, Promise<string>>();

	// Stores the PassphraseRequest promise to avoid re-prompting in case of a correct
	// passphrase, when Obsidian is doing multiple async read calls.
	private passphraseRequestPromise: Promise<string | null> | null = null;

	private originalAdapterReadFunction: (normalizedPath: string) => Promise<string>;
	private originalAdapterWriteFunction: (normalizedPath: string, data: string, options?: DataWriteOptions) => Promise<void>
	private originalAdapterProcessFunction: (normalizedPath: string, fn: (data: string) => string, options?: DataWriteOptions) => Promise<string>;
	private hookedAdapterReadRef: (normalizedPath: string) => Promise<string>;
	private hookedAdapterWriteRef: (normalizedPath: string, data: string, options?: DataWriteOptions) => Promise<void>;
	private hookedAdapterProcessRef: (normalizedPath: string, fn: (data: string) => string, options?: DataWriteOptions) => Promise<string>;

	private originalVaultCachedReadFunction: (file: TFile) => Promise<string>;
	private originalFileRecoveryOnFileChangeFunction: (file: TFile) => Promise<unknown>;
	private originalFileRecoveryForceAddFunction: (normalizedPath: string, data: string) => Promise<unknown>;
	private hookedVaultCachedReadRef: (file: TFile) => Promise<string>;
	private hookedFileRecoveryOnFileChangeRef:(file: TFile) => Promise<unknown>;
	private hookedFileRecoveryForceAddRef: (normalizedPath: string, data: string) => Promise<unknown>;

	async onload() {
		//@ts-ignore
		_log("gpgCrypt DEBUG Build:", (process.env.DEBUG === true));

		// init backends
		this.gpgNative = new BackendNative();
		this.gpgWrapper = new BackendWrapper();
		this.cache = BackendPassphraseCache.create(this);

		// load settings
		await this.loadSettings();	
		
		this.addSettingTab(new SettingsTab(this.app, this, this.settings));

		// load the keys when the layout is ready
		this.app.workspace.onLayoutReady( async () => {
			if (this.settings.firstLoad === true) {
				this.settings.firstLoad = false;
				this.saveSettings();
	
				const action = await new WelcomeModal(this.app, true).openAndAwait();
	
				if (action === "gen-key") {
					this.generateKeypair();
				} else if (action === "open-settings") {
					//@ts-ignore
					this.app.setting.open("gpg-crypt");
					//@ts-ignore
					this.app.setting.openTabById("gpg-crypt");
				}

				return;
			}

			// load keys
			await this.loadKeypair();

			// Ask for passphrase during startup if set
			if (this.settings.backend == Backend.NATIVE && this.settings.askPassphraseOnStartup && this.gpgNative.isPrivateKeyEncrypted() && !this.cache.hasPassphrase()) {
				while (true) {
					try {
						let passphrase = await this.requestPassphraseModal();
						await this.gpgNative.testPassphrase(passphrase);

						// only cache password when the passphrase test was successful
						if (passphrase) { 
							this.cache.setPassphrase(passphrase);
							new Notice(`Private key successfully unlocked. It will remain unlocked for ${this.settings.passphraseTimeout} seconds.`)
							break;
						}
					} catch (error) {
						_log(error);
						new Notice(error.message);

						if(!error.message.includes("Incorrect key passphrase")) {
							break;
						}
					} 
				}
			}
		});


		// file status (if file is encrypted) will be shown in the status bar
		this.statusBarFileState = this.addStatusBarItem();
		this.registerEvent(this.app.workspace.on("file-open", (file) => this.statusBarRefresh(file)));
		this.registerEvent(this.app.vault.on("modify", (file) => this.statusBarRefresh(file as TFile)));

		// save the original Obsidiane functions to call them 
		// and in case of plugin unload, we restore them
		this.originalAdapterReadFunction = this.app.vault.adapter.read;
		this.originalAdapterWriteFunction = this.app.vault.adapter.write;
		this.originalAdapterProcessFunction = this.app.vault.adapter.process;
		this.originalVaultCachedReadFunction = this.app.vault.cachedRead;
		//@ts-ignore
		this.originalFileRecoveryOnFileChangeFunction = this.app.internalPlugins.plugins["file-recovery"].instance.onFileChanged;
		//@ts-ignore
		this.originalFileRecoveryForceAddFunction = this.app.internalPlugins.plugins["file-recovery"].instance.forceAdd;


		// set our new Obsidian functions for vault,DataAdapter & File-Recovery
		// this is our transparent hook into the filesystem layer
		// The ref properties are used to check any other read/write hooks 
		// by third-party plugins as this could lead to data-loss when
		// gpgCrypt plugin gets unloaded.
		this.hookedAdapterReadRef = this.hookedAdapterRead.bind(this);
		this.hookedAdapterWriteRef = this.hookedAdapterWrite.bind(this);
		this.hookedAdapterProcessRef = this.hookedAdapterProcess.bind(this);
		this.hookedVaultCachedReadRef = this.hookedVaultCachedRead.bind(this);
		this.hookedFileRecoveryOnFileChangeRef  = this.hookedFileRecoveryOnFileChange.bind(this);
		this.hookedFileRecoveryForceAddRef = this.hookedFileRecoveryForceAdd.bind(this);
		this.app.vault.adapter.read = this.hookedAdapterReadRef;
		this.app.vault.adapter.write = this.hookedAdapterWriteRef;
		this.app.vault.adapter.process = this.hookedAdapterProcessRef;
		this.app.vault.cachedRead = this.hookedVaultCachedReadRef;

		// Obsidian introduced in their internal "file-recovery" some event registrations.
		// As the general patching doesnt work with them (as the event registration references will still show to the original functions), 
		// we are deactivating the events, patching the functions and the re-registering them.
		//@ts-ignore
		this.app.vault.off('modify', this.app.internalPlugins.plugins["file-recovery"].instance.onFileChanged);
		//@ts-ignore
		this.app.workspace.off('file-open', this.app.internalPlugins.plugins["file-recovery"].instance.onFileChanged);

		//@ts-ignore
		this.app.internalPlugins.plugins["file-recovery"].instance.onFileChanged = this.hookedFileRecoveryOnFileChangeRef;
		//@ts-ignore
		this.app.internalPlugins.plugins["file-recovery"].instance.forceAdd = this.hookedFileRecoveryForceAddRef;

		//@ts-ignore
		this.app.vault.on('modify', this.app.internalPlugins.plugins["file-recovery"].instance.onFileChanged);
		//@ts-ignore
		this.app.workspace.on('file-open', this.app.internalPlugins.plugins["file-recovery"].instance.onFileChanged);


		// register gpg files as markdown
		this.registerExtensions(["gpg"], "markdown");

		// file menu
		this.registerEvent(
			this.app.workspace.on("file-menu", async (menu, file) => {
				const tFile = (file as TFile);
				if (tFile.extension !== "md" && tFile.extension !== "gpg") {
					return;
				}

				const isEncrypted = this.encryptedFileStatus.get(tFile.path);
				const isUnknownFile = (isEncrypted === undefined);

				if (isEncrypted === false || isUnknownFile) {
					menu.addItem((item) => {
						item.setTitle("Encrypt with key pair")
							.setIcon("lock")
							.onClick(async () => {
								this.persistentFileEncrypt(tFile);
							});
					});
				}

				if (isEncrypted === true || isUnknownFile) {
					menu.addItem((item) => {
						item.setTitle("Decrypt permanently")
							.setIcon("unlock")
							.onClick(async () => {
								this.persistentFileDecrypt(tFile);
							});
					});
				} 
			})
		);
	}

	override async onunload(): Promise<void> {
		// We check here for any other hooks by third-party plugins
		// as this could lead to dataloss when gpgCrypt is getting unloaded
		//@ts-ignore
		if (
			this.app.vault.adapter.read != this.hookedAdapterReadRef ||
			this.app.vault.adapter.write != this.hookedAdapterWriteRef ||
			this.app.vault.adapter.process != this.hookedAdapterProcessRef ||
			this.app.vault.cachedRead != this.hookedVaultCachedReadRef ||
			//@ts-ignore
			this.app.internalPlugins.plugins["file-recovery"].instance.onFileChanged != this.hookedFileRecoveryOnFileChangeRef || 
			//@ts-ignore
			this.app.internalPlugins.plugins["file-recovery"].instance.forceAdd != this.hookedFileRecoveryForceAddRef
		){
			await new DialogModal(this.app).openAndAwait(
				"Inconsistent plugin unload: please restart Obsidian to avoid any issues!",
				undefined,
				false
			);
		}

		// restore original Obsidian read/write functions
		this.app.vault.adapter.read = this.originalAdapterReadFunction;
		this.app.vault.adapter.write = this.originalAdapterWriteFunction;
		this.app.vault.adapter.process = this.originalAdapterProcessFunction;
		this.app.vault.cachedRead = this.originalVaultCachedReadFunction;
		
		// restore file-recovery events and functions.
		//@ts-ignore
		this.app.vault.off('modify', this.app.internalPlugins.plugins["file-recovery"].instance.onFileChanged);
		//@ts-ignore
		this.app.workspace.off('file-open', this.app.internalPlugins.plugins["file-recovery"].instance.onFileChanged);
		//@ts-ignore
		this.app.internalPlugins.plugins["file-recovery"].instance.onFileChanged = this.originalFileRecoveryOnFileChangeFunction;
		//@ts-ignore
		this.app.internalPlugins.plugins["file-recovery"].instance.forceAdd = this.originalFileRecoveryForceAddFunction;
		//@ts-ignore
		this.app.vault.on('modify', this.app.internalPlugins.plugins["file-recovery"].instance.onFileChanged);
		//@ts-ignore
		this.app.workspace.on('file-open', this.app.internalPlugins.plugins["file-recovery"].instance.onFileChanged);

		this.statusBarFileState.remove();
		super.onunload();
	}

	// Gets executed when Obsidian reads a file
	private async hookedAdapterRead(normalizedPath: string): Promise<string> {
		_log(`Hooked Adapter - read (${normalizedPath})`);

		const content = await this.originalRead(normalizedPath)
		const isEncrypted = await this.gpgNative.isEncrypted(content);

		// in case the file status is already marked as encrypted, we don't set it to plaintext
		// so we get a warning in case of the next write
		if (!this.encryptedFileStatus.has(normalizedPath) || this.encryptedFileStatus.get(normalizedPath) !== true) {
			this.encryptedFileStatus.set(normalizedPath, isEncrypted);
		}
		
		if (!isEncrypted) { 
			return content; 
		}

		// As Obsidian is doing multiple read calls for one note opening, it doesnt directly output
		// any exceptions anymore to the user. With this, gpgCrypt has to output any errors to the
		// user over Notices. To avoid duplicated Notices for the same error, the complete
		// note decryption part is now taking place in two promises: one external promise which is getting 
		// cached for multiple calls for the same note and to throw an error on rejection
		// and an internal promise, to show the Notice only once.

		// If we already have a request in flight (with the same encrypted text), share it
		if (this.decryptionCache.has(content)) {
			return this.decryptionCache.get(content)!;
		}

		this.decryptionCache.set(content,  new Promise(async (resolve, reject) => {
			let errorOccurred = false; 
			try {	
				//await new Promise(res => setTimeout(res, 10000))
				resolve(await this.decrypt(normalizedPath, content));
			} catch (error) {
				errorOccurred = true;
				reject (error)
			} finally {
				// Reset for the next time we need an external decrypt.
				// If cache option is set and no error occured, the entry is kept for faster note reopening
				if (errorOccurred || !this.settings.backendWrapper.cache) {
					// In some cases, the promise is executed too fast so it is getting cached for at least 500ms.
					setTimeout(() => { _log(`Delete decryption cache for ${normalizedPath}`); this.decryptionCache.delete(content); }, 500);
				}
			}
		}));
		
		return this.decryptionCache.get(content)!;
	}

	// Gets executed when Obsidian writes a file
	private async hookedAdapterWrite(normalizedPath: string, data: string, options?: DataWriteOptions | undefined): Promise<void>  {
		_log(`Hooked Adapter - write (${normalizedPath})`);

		// skip encryption if its already encrypted
		if (await this.gpgNative.isEncrypted(data) === true) {
			_log('Hooked Adapter - write - skip encryption as it is already encrypted')
			this.encryptedFileStatus.set(normalizedPath, true);
			return await this.originalWrite(normalizedPath, data, options)
		}

		let content: string | null = null;

		try {
			content = await this.originalRead(normalizedPath);
		} catch (error) {
			// ignore any errors here	
			_log(`Hooked Adapter - write - originalRead error: ${error}`)
		}
		
		const isEncrypted = await this.gpgNative.isEncrypted(content);

		try {
			if (content != null && isEncrypted) {
				[normalizedPath, data] = await this.renameAndEncrypt(normalizedPath, data);
			} else if (this.encryptedFileStatus.has(normalizedPath) && this.encryptedFileStatus.get(normalizedPath) === true) {
				const confirmChange = await new DialogModal(this.app).openAndAwait(
					`WARNING: The file "${normalizedPath}" appears to have been modified outside of Obsidian and is no longer encrypted.`,
					"Would you like to re-encrypt the file? If you choose 'No', the content will remain in plaintext (unencrypted)."
				);

				if (confirmChange) {
					[normalizedPath, data] = await this.renameAndEncrypt(normalizedPath, data);
				} else {
					this.encryptedFileStatus.set(normalizedPath, false);
					new Notice(`File "${normalizedPath}" will be saved in plaintext (unencrypted).`, NOTICE_DURATION_MS)
				}
			} else if (this.settings.encryptAll === true) {
				[normalizedPath, data] = await this.renameAndEncrypt(normalizedPath, data);
			}
		} catch (error) {
			_log("An error occurred while reading and encrypting the file: ", error);
			throw error;
		}
		
		return await this.originalWrite(normalizedPath, data, options)
	}

	private async hookedAdapterProcess(normalizedPath: string, fn: (data: string) => string, options?: DataWriteOptions): Promise<string> {
		_log(`Hooked Vault - process (${normalizedPath})`);
		let content: string | null = null;
		// Intercept the callback only when the file is encrypted
		let interceptedFn: (data: string) => string = fn;

		// if the file was not read before by Obsidian
		// we have to get the content (unfortunately) to know if its encrypted or not.
		if(!this.encryptedFileStatus.has(normalizedPath)) {
			content = await this.getFileContent(normalizedPath);
		}

		// if its encrypted, we change the callback to return the encrypted result
		if(this.encryptedFileStatus.get(normalizedPath) === true) {
			if(content === null) {
				content = await this.getFileContent(normalizedPath) || "";
			}

			content = fn(content);
			content = await this.encrypt(content);

			interceptedFn = (data) => {
				return content || "";
			}
		}

		return await this.originalProcess(normalizedPath, interceptedFn, options);
	}

	private async hookedVaultCachedRead(file: TFile): Promise<string> {
		_log(`Hooked Vault - cachedRead (${file.path})`);

		const content = await this.originalVaultCachedRead(file);

		//@ts-ignore
		const fileMarker = file._gpgCryptEncryptCache;
		if (fileMarker !== undefined && fileMarker !== null) {
			_log("Encrypt file cache for file recovery. File marker time gap: ", Date.now() - fileMarker);

			// don't encrypt the content if its already encrypted
			if (await this.gpgNative.isEncrypted(content) === false) {
				return await this.encrypt(content);
			}
		}

		return content; 
	}

	private async hookedFileRecoveryOnFileChange(file: TFile) {
		_log(`Hooked File-Recovery onFileChange (${file?.path})`);

		if (!file) {
			return await this.originalFileRecoveryOnFileChange(file);
		}

		let encryptedFileStatus = this.encryptedFileStatus.get(file.path);

		// if the file was not read before by Obsidian (e.g. in case the file was changed externally)
		// we have to get the content (unfortunately) to know if its encrypted or not.
		// isEncrypted should not be necessary as encryptedFileStatus gets updated by vault.read
		// but Let's double check here to be sure.
		if (encryptedFileStatus === undefined) {
			const content = await this.app.vault.read(file);
			encryptedFileStatus = this.encryptedFileStatus.get(file.path) === true ||
									(encryptedFileStatus === undefined && await this.gpgNative.isEncrypted(content));
		}

		if (encryptedFileStatus === true && this.settings.fileRecovery == FileRecovery.SKIP) {
			_log("File is encrypted - skip");
			return null;
		}
		if (encryptedFileStatus === true && this.settings.fileRecovery == FileRecovery.ENCRYPTED) {
			_log("Mark file for encryption for the hooked cachedRead function");
			//@ts-ignore
			file._gpgCryptEncryptCache = Date.now();
		}

		const output = await this.originalFileRecoveryOnFileChange(file);
		
		// unset file marker
		//@ts-ignore
		file._gpgCryptEncryptCache = null;
		
		return output;
	}

	private async hookedFileRecoveryForceAdd(normalizedPath: string, data: string) {
		_log(`Hooked File-Recovery forceAdd (${normalizedPath})`);
		
		//@ts-ignore
		return this.originalFileRecoveryForceAdd(normalizedPath, data);
	}
	
	async originalRead(normalizedPath: string) {
		return this.originalAdapterReadFunction.call(this.app.vault.adapter, normalizedPath);
	}

	async originalWrite(normalizedPath: string, data: string, options?: DataWriteOptions | undefined) {
		return this.originalAdapterWriteFunction.call(this.app.vault.adapter, normalizedPath, data, options);
	}

	async originalProcess(normalizedPath: string, fn: (data: string) => string, options?: DataWriteOptions): Promise<string> {
		return this.originalAdapterProcessFunction.call(this.app.vault.adapter, normalizedPath, fn, options);
	}

	async originalVaultCachedRead(file: TFile) {
		return this.originalVaultCachedReadFunction.call(this.app.vault, file);
	}

	async originalFileRecoveryOnFileChange(file: TFile) {
		//@ts-ignore
		return this.originalFileRecoveryOnFileChangeFunction.call(this.app.internalPlugins.plugins["file-recovery"].instance, file);
	}

	async originalFileRecoveryForceAdd(normalizedPath: string, data: string) {
		//@ts-ignore
		return this.originalFileRecoveryForceAddFunction.call(this.app.internalPlugins.plugins["file-recovery"].instance, normalizedPath, data);
	}

	async renameAndEncrypt(normalizedPath: string, data: string) {
		const tFile = this.app.vault.getAbstractFileByPath(normalizePath(normalizedPath)) as TFile;

		if (tFile === null) {
			_log(`renameAndEncrypt: TFile is null (${normalizedPath})`)
			return [normalizedPath, data];
		}

		if (this.settings.renameToGpg === true && tFile.extension === "md") {
			_log(`rename to gpg: ${normalizedPath}`)
			const newPath = changeFileExtMdToGpg(normalizedPath);
			try {
				await this.app.fileManager.renameFile(tFile, newPath);
				normalizedPath = newPath;
			} catch (error) {
				const msg = `Rename to gpg file extension failed: ${error}`
				_log(msg);
				new Notice(msg, NOTICE_DURATION_MS);
			}	
		}

		data = await this.encrypt(data);
		this.encryptedFileStatus.set(normalizedPath, true);

		return [normalizedPath, data];
	}

	async encrypt(plaintext: string): Promise<string> {
		if (this.settings.backend == Backend.NATIVE) {
			_log('encrypt - native')
			if(!this.gpgNative.hasPublicKey()) {
				throw new Error("No public key for encryption configured!");
			}

			if(this.settings.resetPassphraseTimeoutOnWrite) {
				_log('encrypt: reset passphrase timeout')
				this.cache.resetTimeout();
			} 

			return this.gpgNative.encrypt(plaintext);
		} else {
			_log('encrypt - wrapper')
			if (Platform.isMobile) {
				throw new Error("GnuPG CLI Wrapper mode is not supported on mobile devices.");
			}

			const args: string[] = ["--armor"];

			// To avoid any command injection here, we check if it looks like a key ID
			if(this.settings.backendWrapper.recipient && isGpgKey(this.settings.backendWrapper.recipient)) {
				args.push("--recipient", this.settings.backendWrapper.recipient)
			} else {
				throw new Error("No valid recipient configured.");
			}

			if(this.settings.backendWrapper.compression === true) {
				args.push("--compression-algo", "zlib");
			} else {
				args.push("--compression-algo", "none");
			}

			if(this.settings.backendWrapper.trustModelAlways) {
				args.push("--trust-model", "always");
			}

			return this.gpgWrapper.encrypt(plaintext, args);
		}
	}

	async decrypt(fileName: string, encryptedText: string): Promise<string> {
	
		if (this.settings.backend == Backend.WRAPPER) {
			if (Platform.isMobile) {
				throw new Error("GnuPG CLI Wrapper mode is not supported on mobile devices.");
			}

			const modal = new WrapperDecryptModal(this.app, fileName);

			try {	
				if (this.settings.backendWrapper.showDecryptModal) {
					modal.open();
				}

				const args: string[] = [];
				if(this.settings.backendWrapper.trustModelAlways) {
					args.push("--trust-model", "always");
				}

				// Init the decryption process to get the kill function
				const decryption =  this.gpgWrapper.initDecrypt(encryptedText);

				// Set the onCancel function in the moda, in case the user inititates the cancellation of the decryption process
				if (this.settings.backendWrapper.showDecryptModal) {
					modal.setOnCancelFn(decryption.kill);
				}

				return await this.gpgWrapper.processDecrypt(decryption.gpgResult);
			} catch (error) {
				_log(error);
				new Notice(error.message, NOTICE_DURATION_MS);
				throw error;
			} finally {
				if (this.settings.backendWrapper.showDecryptModal) {
					modal.close();
				}
			}
		}

		if(!this.gpgNative.hasPrivateKey()) {
			await this.loadKeypair();
		}

		let passphrase: string | null = null;
		// eslint-disable-next-line no-constant-condition
		while (true) {
			try {
				if(this.gpgNative.isPrivateKeyEncrypted()) {
					passphrase = this.cache.getPassphrase();
					if (!passphrase) {
						passphrase = await this.requestPassphraseModal();
					}
				}

				const plainntext = await this.gpgNative.decrypt(encryptedText, passphrase);

				// only cache password when the decryption was successul and a passphrase was used
				if (passphrase) { 
					this.cache.setPassphrase(passphrase);
				}

				return plainntext;
			} catch (error) {
				_log(error);
				new Notice(error.message);
				if(!error.message.includes("Incorrect key passphrase")) {
					throw error;
				}
			}
		}
	}

	private async requestPassphraseModal(): Promise<string | null> {
		// If we already have a request in flight, share it
		if (this.passphraseRequestPromise) {
			return this.passphraseRequestPromise;
		}
		
		this.passphraseRequestPromise = new Promise(async (resolve, reject) => {
			try {
				const passphrase = await new PassphraseModal(this.app).openAndAwait(` for private key "${this.settings.backendNative.privateKeyPath}"`);
				resolve(passphrase);
			} catch (error) {
				reject(error);
			} finally {
				// Reset for the next time we need a passphrase
				this.passphraseRequestPromise = null;
			}
		});
		
		return this.passphraseRequestPromise;
	}

	async persistentFileEncrypt(file: TFile) {
		try {

			// this should at the end call our hookedAdapterRead
			// and will set encryptedFileStatus
			const content = await this.app.vault.read(file);

			if (!this.encryptedFileStatus.has(file.path)) {
				throw Error("Unknown note state: gpgCrypt read function was not executed!");
			} else if (this.encryptedFileStatus.get(file.path) === true) {
				throw Error("Note is already encrypted!");
			}

			if (this.settings.renameToGpg === true && file.extension === "md") {
				_log(`rename to gpg: ${file.path}`)
				const newPath = changeFileExtMdToGpg(file.path);
				try {
					await this.app.fileManager.renameFile(file, newPath);
					// refresh file as the file extension changed
					file = this.app.vault.getAbstractFileByPath(normalizePath(newPath)) as TFile;
				} catch (error) {
					throw Error(`Encryption failed as note could not be renamed to gpg file extension: ${error}`);
				}	
			}
			
			const contentEncrypted = await this.encrypt(content);
			await this.originalWrite(file.path, contentEncrypted);

			this.encryptedFileStatus.set(file.path, true);

			this.statusBarRefresh(file);
		} catch (error) {
			_log(error);
			new Notice(error, NOTICE_DURATION_MS);
		}	
	}

	// Decrypt the file in-place persistently when the user manually triggers the decryption
	async persistentFileDecrypt(file: TFile) {
		try {
			// this should at the end call our hookedAdapterRead
			// and will set encryptedFileStatus
			const content = await this.app.vault.read(file);

			if (!this.encryptedFileStatus.has(file.path)) {
				throw Error("Unknown note state: gpgCrypt read function was not executed!");
			} else if (this.encryptedFileStatus.get(file.path) === false) {
				throw Error("Note is not encrypted!");
			}

			if (this.settings.renameToGpg === true && file.extension === "gpg") {
				_log(`rename to md: ${file.path}`)
				const newPath = changeFileExtGpgToMd(file.path);
				try {
					await this.app.fileManager.renameFile(file, newPath);
					// refresh file as the file extension changed
					file = this.app.vault.getAbstractFileByPath(normalizePath(newPath)) as TFile;
				} catch (error) {
					throw Error(`Decryption failed as note could not be renamed to markdown file extension: ${error}`);
				}	
			}

			await this.originalWrite(file.path, content);

			this.encryptedFileStatus.set(file.path, false);

			this.statusBarRefresh(file);
		} catch (error) {
			_log(error);
			new Notice(error, NOTICE_DURATION_MS);
		}
	}

	// Indicate the file state in the status bar
	private statusBarRefresh(file: TFile | null) {
		const activeFile = this.app.workspace.getActiveFile();
		if(file !== activeFile) {
			return;
		}

		if (file instanceof TFile) {
			if (this.encryptedFileStatus.get(file.path)) {
				this.statusBarFileState.ariaLabel = "Encrypted with key pair";
				this.statusBarFileState.setAttr("data-tooltip-position", "top");
				setIcon(this.statusBarFileState, "lock");
				this.statusBarFileState.show();
			} else {
				this.statusBarFileState.hide();
			}
		}
	}

	async getFileContent(path: string): Promise<string | null> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
	
		if (file instanceof TFile) {
			return await this.app.vault.read(file);
		}

		return null;
	}

	async getFileContentExternal(path: string): Promise<string | null> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
	
		if (file instanceof TFile) {
			return await this.app.vault.read(file);
		}

		_log("getFileContentExternal - File not found - External file fallback");
		try {
			const resourcePath = this.app.vault.adapter.getResourcePath(path)
			_log(`getFileContentExternal resource path: ${resourcePath}`);

			const response = await fetch(resourcePath);
			const content = await response.text();
			
			if (content.length == 0){
				return null;
			}

			_log(`getFileContentExternal content: ${content}`);
			return content;
		} catch(error) {
			_log(error);
			return null;
		}
	}

	async generateKeypair() {
		try {
			const result = await new GenerateKeypairModal(this.app).openAndAwait();

			if (!result.publicKey || !result.privateKey) {
				throw new Error("Key file names must not be empty");
			}
		
			// Check if the public key file exists
			if (
				await this.getFileContent(result.publicKey) !== null ||
				await this.getFileContent(result.privateKey) !== null
			){
				throw new Error("Key files are already existing: aborting key pair generation!");
			}

			const { publicKey, privateKey } = await this.gpgNative.generateKeypair(result.name, result.email, result.passphrase);

			await this.originalWrite(result.publicKey, publicKey);
			await this.originalWrite(result.privateKey, privateKey);

			this.settings.backendNative.publicKeyPath = result.publicKey;
			this.settings.backendNative.privateKeyPath = result.privateKey;

			await this.saveSettings();
			await this.loadKeypair();

			new Notice("Key pair successfully created!", NOTICE_DURATION_MS);

			return true;
		} catch (error) {
			new Notice(error, NOTICE_DURATION_MS);
		}

		return false;
	}

	async loadSettings() {
		const DEFAULT_SETTINGS: Settings = {
			firstLoad: true,

			encryptAll: false,
			renameToGpg: false,

			fileRecovery: FileRecovery.ENCRYPTED,

			backend: Backend.NATIVE,

			backendNative: {
				publicKeyPath: "public.asc",
				privateKeyPath: "private.asc"
			}, 

			backendWrapper: {
				executable: "gpg",
				recipient: "",
				trustModelAlways: false,
				compression: false,
				cache: true,
				showDecryptModal: true,
			},

			askPassphraseOnStartup: false,
			passphraseTimeout: 300,
			resetPassphraseTimeoutOnWrite: false,
		}

		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

		// Ensure native backend on mobile devices
		// e.g. in case the plugin config is synchronized
		if (Platform.isMobile) {
			this.settings.backend = Backend.NATIVE;
		}
		
		// ensure that the passphraseTimeout is minimum 10s
		if (this.settings.passphraseTimeout < 10) {
			this.settings.passphraseTimeout = 10;
		}
		this.cache.setTimeout(this.settings.passphraseTimeout);

		this.gpgWrapper.setExecutable(this.settings.backendWrapper.executable);
	}

	async loadKeypair() {
		const publicKey = await this.getFileContentExternal(this.settings.backendNative.publicKeyPath);
		const privateKey = await this.getFileContentExternal(this.settings.backendNative.privateKeyPath);

		await this.gpgNative.setKeys(publicKey, privateKey);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
