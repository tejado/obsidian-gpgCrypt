#!/usr/bin/env node
// Typings-drift check: does src/ still compile against the NEWEST `obsidian` typings?
// The build pins a known-good version; this script installs the latest typings into a
// throwaway directory and type-checks src/ against them, so a new Obsidian API release
// that breaks the plugin at compile time is reported (advisory job in CI, see F30).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const wanted = process.argv[2] ?? "latest";
const root = resolve(new URL("..", import.meta.url).pathname);
const work = mkdtempSync(join(tmpdir(), "obsidian-typings-"));

try {
	console.log(`Installing obsidian@${wanted} into ${work} …`);
	execFileSync("npm", ["install", "--no-save", "--no-audit", "--no-fund", "--ignore-scripts", `obsidian@${wanted}`], {
		cwd: work,
		stdio: "inherit",
	});
	const installed = JSON.parse(readFileSync(join(work, "node_modules/obsidian/package.json"), "utf8")).version;
	const pinned = JSON.parse(readFileSync(join(root, "node_modules/obsidian/package.json"), "utf8")).version;
	console.log(`Type-checking src/ against obsidian@${installed} (repo pins ${pinned})`);

	// A tsconfig that mirrors the build but maps `obsidian` to the freshly installed typings.
	const base = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"));
	const cfg = {
		...base,
		compilerOptions: {
			...base.compilerOptions,
			baseUrl: root,
			noEmit: true,
			skipLibCheck: true,
			// The generated tsconfig lives in a temp dir: point type resolution back at the repo.
			typeRoots: [join(root, "node_modules/@types")],
			types: ["node"],
			paths: { ...(base.compilerOptions.paths ?? {}), obsidian: [join(work, "node_modules/obsidian/obsidian.d.ts")] },
		},
		include: [join(root, "src/**/*.ts")],
	};
	const cfgPath = join(work, "tsconfig.drift.json");
	writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
	execFileSync(join(root, "node_modules/.bin/tsc"), ["-p", cfgPath], { cwd: root, stdio: "inherit" });
	console.log(`OK: src/ compiles against obsidian@${installed}`);
} catch (err) {
	console.error(`Typings drift detected (or install failed): ${err.message}`);
	process.exit(1);
} finally {
	rmSync(work, { recursive: true, force: true });
}
