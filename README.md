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
- Enable/disable compression
- Tested with Obsidian Sync
- Status bar integration


## Installation

Install it manually or use the Obsidian plugin [Beta Reviewers Auto-update Tester](https://github.com/TfTHacker/obsidian42-brat).

Once the plugin is published on the Obsidian Plugins website, it will be noted here.

## Usage

Initially, a key pair is required. The first time you load gpgCrypt, a dialog for key pair generation appears automatically. If you wish to use gpg CLI or adjust other settings, navigate to "gpgCrypt" within the Obsidian Settings.

To encrypt or decrypt notes, right-click the desired note and choose "Encrypt with Key Pair" or "Decrypt Permanently" from the file context menu.

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
