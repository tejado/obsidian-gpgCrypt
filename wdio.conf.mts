/**
 * WebdriverIO + wdio-obsidian-service configuration: runs the built plugin (dist/) inside REAL Obsidian
 * instances downloaded on demand — one capability per Obsidian version, desktop and (emulated) mobile.
 *
 *   OBSIDIAN_VERSIONS   space separated "app/installer" pairs, default "earliest/earliest latest/latest"
 *                       (earliest = manifest.json minAppVersion). "latest-beta/latest" is added automatically
 *                       when Catalyst credentials (OBSIDIAN_EMAIL/OBSIDIAN_PASSWORD) are present.
 *   E2E_MOBILE=0        skip the emulated-mobile capabilities
 *   E2E_DESKTOP=0       skip the desktop capabilities (mobile emulation only)
 *   WDIO_MAX_INSTANCES  parallel Obsidian instances (default 2)
 *   E2E_GPG=1           enable the GnuPG CLI wrapper spec (needs gpg + fixture keys in GNUPGHOME)
 *
 */
import * as path from "node:path";
import { env } from "node:process";
import { obsidianBetaAvailable, parseObsidianVersions } from "wdio-obsidian-service";

const cacheDir = path.resolve(".obsidian-cache");

let defaultVersions = "earliest/earliest latest/latest";
if (await obsidianBetaAvailable({ cacheDir })) {
	defaultVersions += " latest-beta/latest";
}
const desktopVersions = env.E2E_DESKTOP === "0" ? [] : await parseObsidianVersions(env.OBSIDIAN_VERSIONS || defaultVersions, { cacheDir });
const mobileVersions =
	env.E2E_MOBILE === "0" ? [] : await parseObsidianVersions(env.OBSIDIAN_MOBILE_VERSIONS || env.OBSIDIAN_VERSIONS || defaultVersions, { cacheDir });

if (env.CI) {
	// Printed so the GitHub workflow can use the resolved versions as the actions/cache key.
	console.log("obsidian-cache-key:", JSON.stringify([desktopVersions, mobileVersions]));
}

const pluginOptions = {
	plugins: ["./dist"],
	vault: "e2e/vaults/basic",
};

export const config: WebdriverIO.Config = {
	runner: "local",
	framework: "mocha",
	// One nested group = all spec files of a capability run sequentially IN ONE Obsidian session
	// (per-spec sessions would relaunch Obsidian 12× per cell and give every spec a fresh vault copy,
	// which makes the end-of-run canary sweep meaningless). Order is alphabetical; 99-canary-sweep is last.
	specs: [["./e2e/specs/**/*.e2e.ts"]],
	maxInstances: Number(env.WDIO_MAX_INSTANCES || 2),

	capabilities: [
		...desktopVersions.map<WebdriverIO.Capabilities>(([appVersion, installerVersion]) => ({
			browserName: "obsidian",
			browserVersion: appVersion,
			"wdio:obsidianOptions": { appVersion, installerVersion, ...pluginOptions },
		})),
		...mobileVersions.map<WebdriverIO.Capabilities>(([appVersion, installerVersion]) => ({
			browserName: "obsidian",
			browserVersion: appVersion,
			"wdio:obsidianOptions": { appVersion, installerVersion, emulateMobile: true, ...pluginOptions },
			"goog:chromeOptions": {
				mobileEmulation: { deviceMetrics: { width: 390, height: 844 } },
			},
		})),
	],

	services: ["obsidian"],
	reporters: ["obsidian"],

	mochaOpts: {
		ui: "bdd",
		timeout: 90_000,
	},
	waitforInterval: 250,
	waitforTimeout: 10_000,
	logLevel: "warn",
	outputDir: "logs",
	cacheDir,
	injectGlobals: false,

	// WDIO's automatic per-worker `xvfb-run` wrapping is incompatible with the worker IPC channel
	// (Debian's xvfb-run closes fd 3 → "write EINVAL" in @wdio/local-runner/run.js). A display is
	// provided for the whole run instead: `npm run test:e2e` (scripts/e2e.mjs) wraps the launcher in
	// xvfb-run on headless Linux, CI starts Xvfb explicitly.
	autoXvfb: false,
};
