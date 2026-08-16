#!/usr/bin/env node
// Launcher for the E2E tests (`npm run test:e2e [-- <wdio args>]`).
//
// On headless Linux (no DISPLAY) it wraps the WHOLE wdio launcher in `xvfb-run` and starts a window
// manager inside that display when one is available. Wrapping the launcher is safe; wrapping each
// worker (WDIO's autoXvfb) is not — Debian's xvfb-run closes fd 3, which is the worker's IPC channel
// ("write EINVAL"), so autoXvfb is disabled in wdio.conf.mts.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { platform, env } from "node:process";

const root = resolve(new URL("..", import.meta.url).pathname);
const wdioBin = resolve(root, "node_modules/@wdio/cli/bin/wdio.js");
const wdioArgs = ["run", "./wdio.conf.mts", ...process.argv.slice(2)];

if (!existsSync(wdioBin)) {
	console.error("wdio is not installed — run `npm ci` first");
	process.exit(1);
}

const which = (cmd) => spawnSync(platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" }).status === 0;
const needsDisplay = platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY;

let cmd;
let args;
if (needsDisplay) {
	if (!which("xvfb-run")) {
		console.error(
			"No DISPLAY and no xvfb-run found. Install a virtual display first, e.g.\n" +
				"  sudo apt-get install -y xvfb herbstluftwm libgtk-3-0 libnss3 libasound2t64\n" +
				"or start Xvfb yourself and export DISPLAY.",
		);
		process.exit(1);
	}
	const wm = which("herbstluftwm") ? "herbstluftwm" : which("openbox") ? "openbox" : "";
	if (!wm) console.warn("(no window manager found — some Obsidian UI features may misbehave; `sudo apt-get install herbstluftwm`)");
	// sh -c: start the WM in the background inside the Xvfb display, then exec the wdio launcher
	const inner = `${wm ? `(${wm} >/dev/null 2>&1 &) ; sleep 0.5; ` : ""}exec "$@"`;
	cmd = "xvfb-run";
	args = ["--auto-servernum", "--server-args=-screen 0 1280x1024x24 +extension GLX -noreset", "--", "sh", "-c", inner, "sh", process.execPath, wdioBin, ...wdioArgs];
	console.log("No DISPLAY set — running the e2e suite under xvfb-run" + (wm ? ` (+ ${wm})` : ""));
} else {
	cmd = process.execPath;
	args = [wdioBin, ...wdioArgs];
}

const child = spawn(cmd, args, { cwd: root, stdio: "inherit", env });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
child.on("error", (err) => {
	console.error(err.message);
	process.exit(1);
});
