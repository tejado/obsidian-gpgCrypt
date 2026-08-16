/**
 * Canary sweep — runs LAST in each Obsidian instance (spec order is alphabetical, hence "99-").
 *
 * Part 1 inspects the vault copy exactly as the previous specs left it (NO reset first): the plaintext
 * canaries written by 04-edit-encrypted-note must not survive anywhere on disk — neither in notes nor in
 * `.obsidian/` — and the plugin's key files must be intact. Every spec resets the vault at the start of
 * each test, so the only legitimate residue is what the very last test wrote; any canary in plaintext
 * means a write path bypassed encryption (F29-style) or a reset failed to restore a leaked file.
 *
 * Part 2 resets the vault and checks the baseline state the other specs rely on.
 */
import { expect } from "@wdio/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import { obsidianPage } from "wdio-obsidian-service";
import { CANARY, PRESETS, isArmoredMessage, readPluginData, resetWithSettings, vaultPath } from "../helpers/plugin.js";

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === ".trash") continue;
			walk(p, out);
		} else out.push(p);
	}
	return out;
}

/** Every file (relative path → content) in the vault copy, including `.obsidian/`. */
function snapshot(): Map<string, string> {
	const root = obsidianPage.getVaultPath();
	const out = new Map<string, string>();
	for (const f of walk(root)) {
		let content = "";
		try {
			content = fs.readFileSync(f, "utf8");
		} catch {
			continue; // binary/unreadable
		}
		out.set(path.relative(root, f).split(path.sep).join("/"), content);
	}
	return out;
}

const KEY_FILES = ["public.asc", "private.asc", "public-pw.asc", "private-pw.asc"];

describe("99 canary sweep (runs last)", function () {
	describe("residue left by all previous specs (no reset)", function () {
		it("no plaintext canary survives anywhere in the vault copy — notes, .obsidian/, plugin data", function () {
			const leaks: string[] = [];
			for (const [rel, content] of snapshot()) {
				if (isArmoredMessage(content)) continue; // ciphertext may contain anything
				for (const canary of Object.values(CANARY)) {
					if (content.includes(canary)) leaks.push(`${rel} contains ${canary}`);
				}
			}
			expect(leaks).toEqual([]);
		});

		it("the key files were never overwritten or encrypted", function () {
			for (const rel of KEY_FILES) {
				const content = fs.readFileSync(vaultPath(rel), "utf8");
				expect(content.startsWith("-----BEGIN PGP")).toBe(true);
				expect(content).toContain("KEY BLOCK-----");
				expect(isArmoredMessage(content)).toBe(false);
			}
		});

		it("the plugin's data.json is valid JSON and not encrypted", function () {
			const data = readPluginData();
			expect(Object.keys(data)).toEqual(expect.arrayContaining(["encryptAll", "backend", "backendNative", "backendWrapper", "fileRecovery"]));
			expect(isArmoredMessage(fs.readFileSync(vaultPath(".obsidian/plugins/gpg-crypt/data.json"), "utf8"))).toBe(false);
		});
	});

	describe("baseline after a reset", function () {
		before(async function () {
			await resetWithSettings(PRESETS.default);
		});

		it("encrypted fixtures are complete OpenPGP messages, plaintext fixtures are plaintext, no canaries", function () {
			const snap = snapshot();
			for (const rel of ["Encrypted.md", "EncryptedPw.md", "Encrypted.gpg"]) {
				expect(isArmoredMessage(snap.get(rel))).toBe(true);
			}
			for (const rel of ["Plain.md", "secret/InFolder.md", "secret/nested/Deep.md", "other/Outside.md"]) {
				expect(snap.has(rel)).toBe(true);
				expect(isArmoredMessage(snap.get(rel))).toBe(false);
			}
			const leaks = [...snap.entries()].filter(([, c]) => Object.values(CANARY).some((canary) => c.includes(canary))).map(([rel]) => rel);
			expect(leaks).toEqual([]);
		});

		it("files created by earlier specs are gone again", function () {
			for (const rel of ["Plain.gpg", "Second.md", "New.md", "gen-pub.asc", "gen-priv.asc"]) {
				expect(fs.existsSync(vaultPath(rel))).toBe(false);
			}
		});
	});
});
