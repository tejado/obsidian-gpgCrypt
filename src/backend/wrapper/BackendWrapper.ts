import { _log } from "src/common/utils";
import spawnGPG, { GpgResult, GpgSpawnResult } from "./spawnGPG"

export enum CliPathStatus {
    FOUND = "FOUND",
    NO_GPG_IN_PATH = "NO_GPG_IN_PATH",
    NO_GPG_IN_OUTPUT = "NO_GPG_IN_OUTPUT",
    ENOENT = "ENOENT",
    NO_PERMISSION = "NO_PERMISSION",
    UNKNOWN_ERROR = "UNKNOWN"
}

export class GPGStatusMessage {
	static getFriendlyMessage(status: CliPathStatus): string {
		switch (status) {
			case CliPathStatus.FOUND:
				return "GPG found.";
			case CliPathStatus.NO_GPG_IN_PATH:
				return "GPG is not in the specified path.";
			case CliPathStatus.NO_GPG_IN_OUTPUT:
				return "The output does not indicate this is GPG.";
			case CliPathStatus.ENOENT:
				return "File or directory not found.";
			case CliPathStatus.NO_PERMISSION:
				return "Access to the executable file has been denied.";
			case CliPathStatus.UNKNOWN_ERROR:
				return "An unknown error occurred.";
		}
	}
}

export class BackendWrapper {

	// The path to the gpg cli executable, usually gpg or gpg.exe
	private cliPath = "gpg";

	getExecutable() {
		return this.cliPath;
	}
  
	setExecutable(path: string) {
		this.cliPath = path;
	}

	checkPath(path: string) {
		path = path.trim();

		if (
			path.endsWith("gpg") || 
            path.endsWith("gpg.exe") || 
            path.endsWith("gpg2") || 
            path.endsWith("gpg2.exe") 
		){
			return true;
		}

		return false;
	}

	async isGPG(path: string): Promise<CliPathStatus> {
		if (!this.checkPath(path)) {
			return CliPathStatus.NO_GPG_IN_PATH;
		}

		try {
			const versionOutput: string = await this.version(path);
			// Check if the version output contains specific markers for gpg
			if(versionOutput.includes("gpg") && versionOutput.includes("GnuPG")) {
				return CliPathStatus.FOUND;
			} else {
				return CliPathStatus.NO_GPG_IN_OUTPUT;
			}
		} catch (err) {
			_log(err);

			if (err.code === "ENOENT") {
				return CliPathStatus.ENOENT;
			} else if (err.code === "EACCES" || err.code === "EPERM") {
				return CliPathStatus.NO_PERMISSION;
			} else {
				return CliPathStatus.UNKNOWN_ERROR;
			}
		}
	}

	async version(path?: string): Promise<string> {
		const defaultArgs = ["--logger-fd", "1", "--version"];

		const { gpgResult, kill } =  spawnGPG(path || this.cliPath, null, defaultArgs);
		const { result, error } = await gpgResult;
		if(result && !error) {
			return result.toString().trim();
		} else {
			throw error;
		}
	}

	async getPublicKeys(): Promise<{ keyID: string; userID: string }[]> {
		const defaultArgs = ["--logger-fd", "1", "--list-public-keys", "--with-colons"];
    
		const { gpgResult, kill } = spawnGPG(this.cliPath, null, defaultArgs);
        const { result } = await gpgResult;

		if(!result) {
			return [];
		}
        
		// Split the output by newline
		const lines = result.toString().trim().split("\n");
    
		// Prepare a list to store the results
		const keys: { keyID: string; userID: string }[] = [];
		let currentKeyID: string | null = null;
    
		// Iterate over each line
		for (const line of lines) {
			// Split the line by colons
			const parts = line.split(":");
    
			// If the line starts with 'pub', then it's a public key line
			if (parts[0] === "pub") {
				currentKeyID = parts[4]; // The key ID is in the fifth position
			} 
    
			// If the line starts with 'uid', then it's a user ID line
			if (parts[0] === "uid" && currentKeyID) {
				keys.push({
					keyID: currentKeyID,
					userID: parts[9] // The user ID is in the tenth position
				});
			}
		}
    
		return keys;
	}


	async encrypt(plaintext: string, args?: string[]): Promise<string> {
		const defaultArgs = ["--encrypt"];
		const { gpgResult, kill } = spawnGPG(this.cliPath, plaintext, defaultArgs, args);

		const { result, error } = await gpgResult;
       
		if(result) {
			return result.toString().trim();
		} else {
			throw error;
		}
	}

	initDecrypt(plaintext: string, args?: string[]): GpgSpawnResult {
		const defaultArgs = ["--decrypt"];
		return spawnGPG(this.cliPath, plaintext, defaultArgs, args);
	}

	async processDecrypt(gpgResult: Promise<GpgResult>): Promise<string> {
		const { result, error } = await gpgResult;

		if(result) {
			return result.toString().trim();
		} else {
			throw error;
		}
	}
}