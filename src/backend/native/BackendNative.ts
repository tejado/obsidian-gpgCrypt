import * as openpgp from "openpgp";


export class BackendNative {

	private publicKey: openpgp.PublicKey | null = null;
	private privateKey: openpgp.PrivateKey | null = null;
	private privateKeyArmored: string | null = null;

	hasPublicKey(): boolean {
		return (this.publicKey != null);
	}

	hasPrivateKey(): boolean {
		return (this.privateKey != null);
	}

	isPrivateKeyEncrypted() {
		return this.privateKey && !this.privateKey.isDecrypted();
	}

	setPassphrase() {
		return this.privateKey && this.privateKey.isDecrypted;
	}

	async setKeys(publicKey: string | null, privateKey: string | null) {
		if (publicKey) {
			this.publicKey = await openpgp.readKey({ armoredKey: publicKey });
		} else {
			this.publicKey = null;
		}

		if (privateKey) {
			this.privateKey = await openpgp.readPrivateKey({ armoredKey: privateKey });
			this.privateKeyArmored = privateKey;
		} else {
			this.privateKey = null;
			this.privateKeyArmored = null;
		}

	}
    
	async encrypt(plaintext: string) {
		if(!this.publicKey) {
			throw new Error("No public key for encryption configured!");
		}

		const encrypted = await openpgp.encrypt({
			message: await openpgp.createMessage({ text: plaintext }),
			encryptionKeys: this.publicKey,
		});	

		return encrypted;
	}

	async decrypt(encrypted: string, passphrase: string | null) {
		if(!this.privateKey || !this.privateKeyArmored) {
			throw new Error("No private key for decryption configured!");
		}

		let privateKey = this.privateKey;

		if (this.isPrivateKeyEncrypted()) {
			if(passphrase !== null) {
				privateKey = await  openpgp.decryptKey({
					privateKey: await openpgp.readPrivateKey({ armoredKey: this.privateKeyArmored }),
					passphrase
				});
			} else {
				throw new Error("No passphrase for private key provided!");
			}
		}

		const message = await openpgp.readMessage({
			armoredMessage: encrypted
		});
        
		const { data: decrypted } = await openpgp.decrypt({
			message,
			decryptionKeys: privateKey
		});

		return decrypted;
	}

	async testPassphrase(passphrase: string | null) {
		if(!this.privateKey || !this.privateKeyArmored) {
			throw new Error("No private key for decryption configured!");
		}

		if (!this.isPrivateKeyEncrypted()) { 
			throw new Error("Private key is not encrypted.");
		}

		if(passphrase === null) { 
			throw new Error("No passphrase for private key provided!");
		}
	
		await openpgp.decryptKey({
			privateKey: await openpgp.readPrivateKey({ armoredKey: this.privateKeyArmored }),
			passphrase
		});
	}

	async isEncrypted(content: string | null): Promise<boolean> {
		if (content == null) {
			return false;
		}

		try {
			// Attempt to read the buffer as a PGP message
			const message = await openpgp.readMessage({armoredMessage: content});
			if (message) return true;
		} catch (err) {
			// If an error occurs, it's likely not a valid PGP encrypted file
		}

		return false;
	}

	async generateKeypair(name: string, email: string, passphrase: string): Promise<{publicKey: string, privateKey: string}> {
		const { privateKey, publicKey } = await openpgp.generateKey({
			type: 'curve25519',
			userIDs: [{ name: name, email: email}], 
			passphrase: passphrase,
			format: "armored"
		});

		return {publicKey, privateKey};
	}
}