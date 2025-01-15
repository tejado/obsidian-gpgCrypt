import { BackendNativeSettings } from "src/backend/native/BackendNativeSettings";
import { BackendWrapperSettings } from "src/backend/wrapper/BackendWrapperSettings";

export enum FileRecovery { 
    PLAINTEXT = "plaintext",
    ENCRYPTED = "encrypted",
	SKIP = "skip",
}

export const FileRecoveryDescription: { [key in FileRecovery]: string } = {
	[FileRecovery.ENCRYPTED]: "Encrypted (manual decrypt in case of recovery)",
	[FileRecovery.PLAINTEXT]: "Plaintext",
	[FileRecovery.SKIP]: "Disable file recovery for encrypted notes",
};

export interface Settings {
	firstLoad: boolean, 
	encryptAll: boolean,
	renameToGpg: boolean,
	fileRecovery: string,
	backend: string;

	backendNative : BackendNativeSettings;
	backendWrapper : BackendWrapperSettings;

	askPassphraseOnStartup: boolean;
	passphraseTimeout: number;
}