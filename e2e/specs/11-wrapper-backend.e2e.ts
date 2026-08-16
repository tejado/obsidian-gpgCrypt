/**
 * GnuPG CLI wrapper backend inside real Obsidian — OPT-IN (E2E_GPG=1), desktop only.
 * Requires a `gpg` binary and an isolated GNUPGHOME with the fixture keys imported;
 * the Obsidian process inherits GNUPGHOME from the test runner.
 */
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { PRESETS, activeEditorText, diskRead, isArmoredMessage, resetWithSettings, waitForDisk } from "../helpers/plugin.js";

const GPG_BIN = process.env.GPG_BIN || "gpg";
const NOPASS_KEY_ID = "B48213D516D720CC"; // tests/fixtures/keys/nopass (see tests/helpers/fixtures.ts)

describe("11 GnuPG CLI wrapper backend (opt-in)", function () {
	before(async function () {
		if (process.env.E2E_GPG !== "1") this.skip();
		const platform = await obsidianPage.getPlatform();
		if (platform.isMobile) this.skip();
		await resetWithSettings(PRESETS.default, {
			backend: "wrapper",
			backendWrapper: {
				executable: GPG_BIN,
				recipient: NOPASS_KEY_ID,
				trustModelAlways: true,
				compression: false,
				cache: true,
				showDecryptModal: true,
			},
		});
	});

	it("encrypts a note through the gpg CLI and decrypts it again on open", async function () {
		await obsidianPage.openFile("Plain.md");
		await browser.executeObsidianCommand("gpg-crypt:gpg-encrypt-permanently");
		const ct = await waitForDisk("Plain.md", isArmoredMessage, 30_000);
		expect(ct).toContain("-----BEGIN PGP MESSAGE-----");

		// re-open → decrypt via gpg (may briefly show the "Decryption in progress..." modal)
		await browser.executeObsidian(({ app }) => app.workspace.detachLeavesOfType("markdown"));
		await obsidianPage.openFile("Plain.md");
		await browser.waitUntil(async () => (await activeEditorText())?.includes("This note is not encrypted.") ?? false, {
			timeout: 30_000,
			timeoutMsg: `wrapper decrypt did not produce plaintext; disk=${diskRead("Plain.md")?.slice(0, 40)}`,
		});
	});
});
