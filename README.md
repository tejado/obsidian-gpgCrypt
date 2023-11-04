# gpgCrypt for Obsidian

gpgCrypt is an Obsidian plugin to encrypt your notes effortlessly and seamlessly using GnuPG. All Obsidian functions can be used as usual, without reduced Markdown experience.  
It integrates OpenPGP.js or your local GnuPG installation. For those seeking more advanced security measures, integration with the local GnuPG installation enables the use of OpenPGP smartcards (e.g. with YubiKey or Nitrokey).

[gpgCrypt](https://github.com/tejado/obsidian-gpgCrypt) is developed by [github.com/tejado](https://github.com/tejado).

**Note:** The Obsidian plugin is still in beta! Use it at your own risk!  
**Warning:** Encrypted notes might be stored unencrypted on disk due to Obsidian's caching mechanisms, coredumps, or other reasons.

### Features

- Asymmetric encryption with key pair
- Seamless for maximum compatibility
- OpenPGP smartcard support (e.g. with YubiKey, Nitrokey, ...) over gpg CLI Wrapper
- Configurable duration of remembering your password
- Configure how encrypted notes should be handled by the file recovery core plugin.
- Option to encrypt all notes
- Enable/disable compression
- Tested with Obsidian Sync
- Status bar integration

## Installation

gpgCrypt is available over Obsidian Plugins: [obsidian.md - gpgCrypt](https://obsidian.md/plugins?search=gpgCrypt).

As an alternative, you can install it manually or use the Obsidian plugin [Beta Reviewers Auto-update Tester](https://github.com/TfTHacker/obsidian42-brat).

## Usage

To encrypt and decrypt your notes, gpgCrypt requires a key pair: 
- **Public key** for encryption
- **Private key** for decryption (passphrase-protected private keys are supported).

When you load gpgCrypt for the first time, a welcome dialog opens. **Generate** or use an **existing** key pair to encrypt your notes.  
To use existing key pair, open gpgCrypt plugin settings and select an encryption backend: **OpenPGP.js** or **GnuPG CLI Wrapper**.

### OpenPGP.js

1. Place your key pair in your Obsidian Vault. The keys should be in ASCII format with a .asc extension. For example, public.asc and private.asc.
2. Open gpgCrypt plugin settings in Obsidian.
3. Under `Public key` and `Private key`, set the paths to your key files relative to your Obsidian Vault

### GnuPG CLI Wrapper

1. Open gpgCrypt plugin settings in Obsidian
2. Set encryption backend to `GnuPG CLI Wrapper`
3. Make sure the `GPG executable` path is set correctly.
4. Select the GPG key you wish to use to encrypt your notes.

### How to encrypt your notes

Encryption must be performed individually for each note. Navigate to the note's context menu and choose `Encrypt with key pair`.  
To ensure all your notes are encrypted, turn on the `Encrypt all notes` feature in the settings of the gpgCrypt plugin. Each note will be encrypted upon its next modification.

## FAQ 

### Error "Unusable public key"
The error ***There is no assurance this key belongs to the named user. Unusable public key*** happens in `GnuPG CLI Wrapper` mode when you imported the key and did not any specific trust for the key. In this case, gpg can't use the key.
Two solutions:
- Set a specific trust for your key pair over gpg, e.g. using the gpg CLI
- or enable `Always trust keys` in the gpgCrypt plugin settings.

More information:
- https://en.wikipedia.org/wiki/Web_of_trust
- https://security.stackexchange.com/questions/41208/what-is-the-exact-meaning-of-this-gpg-output-regarding-trust

### Encrypt & decrypt outside of Obsidian

Following commands can be used to encrypt/decrypt the files outside of Obsidian:

```cmd
gpg --encrypt --armor --output - --recipient RECIPIENT_EMAIL_OR_KEY_ID path/to/vault/note.md
```

```cmd
gpg --decrypt --output - path/to/vault/note.md
```

## Limitations

- Only Markdown (.md) files are supported for now, as Obsidian handles other file types (like PDFs or images) in different ways.
- Desktop-only as it was not yet tested on mobile clients.
- For OpenPGP.js, the key pair needs to be located inside the Obsidian Vault.
- No signature support
- No symmetric encryption 

## Manually installing the plugin

- Clone this repo.
- Make sure your NodeJS is at least v16 (`node --version`).
- `npm i` or `yarn` to install dependencies.
- `npm run dev` to start compilation in watch mode.
- Copy over `main.js` and `manifest.json` to your vault `VaultFolder/.obsidian/plugins/gpgCrypt/`.
- Alternative: `npm run dev VaultFolder/.obsidian/plugins/gpgCrypt/` to start compilation in watch mode directly into your vault.

## Credits

- [mnaoumov](https://github.com/mnaoumov) gave me the decisive hint about the Obsidian API.
- [meld-cp](https://github.com/meld-cp) partly inspired me with his [Meld Encrypt](https://github.com/meld-cp/obsidian-encrypt) plugin.
