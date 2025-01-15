import GpgPlugin from "src/main";

export class BackendPassphraseCache {

	// passphrase which was provided by the user
	private passphrase: string | null = null;
    
	// how long a user passphrase should be cached
	private timeout = 300;

	// timestamp when the passphrase was set
	private lastSet = 0;


	public static create(plugin: GpgPlugin): BackendPassphraseCache {
		return new BackendPassphraseCache(plugin);
	}

	private constructor(plugin: GpgPlugin) {
		this.setTimeout(this.timeout);
		plugin.registerInterval(window.setInterval(() => this.clearCache(), 1000));
	}


	public static isValidTimeout(timeout: number): boolean {
		return (!isNaN(timeout) && timeout > -1 && timeout < 60*60*24*30);
	}

	public hasPassphrase(): boolean {
		return (this.passphrase != null);
	}

	public setPassphrase(passphrase: string) {
		// cache the pasphrase only when cache is enabled and 
		// the new passphrase different than the current one
		if(this.timeout > 0 && this.passphrase != passphrase) {
			this.passphrase = passphrase;
			this.lastSet = Date.now();
		}
	}

	public getPassphrase() {
		return this.passphrase;
	}

	public setTimeout(timeout: number) {
		if (BackendPassphraseCache.isValidTimeout(timeout)) {
			this.timeout = timeout;
		}
	}

	private clearCache() {
		if (this.timeout > 0 && Date.now() >= (this.lastSet + this.timeout * 1000)) {
			this.passphrase = null;
		}
	}
}