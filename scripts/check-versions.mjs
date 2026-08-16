#!/usr/bin/env node
// Release-integrity check:
//   package.json.version === manifest.json.version (=== git tag when --tag is given)
//   versions.json has an entry for manifest.version pointing at manifest.minAppVersion
//   manifest.minAppVersion is a plausible semver
// Usage: node scripts/check-versions.mjs [--tag <tag>] [--dist <dir>]
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const argValue = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
const tag = argValue("--tag");
const dist = argValue("--dist");

const read = (f) => JSON.parse(readFileSync(resolve(f), "utf8"));
const pkg = read("package.json");
const manifest = read("manifest.json");
const versions = read("versions.json");

const problems = [];
const semver = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

if (!semver.test(manifest.version)) problems.push(`manifest.json version "${manifest.version}" is not semver`);
if (!semver.test(manifest.minAppVersion)) problems.push(`manifest.json minAppVersion "${manifest.minAppVersion}" is not semver`);
if (pkg.version !== manifest.version) problems.push(`package.json version ${pkg.version} != manifest.json version ${manifest.version}`);
if (tag !== undefined && tag !== manifest.version) problems.push(`git tag ${tag} != manifest.json version ${manifest.version}`);
if (!(manifest.version in versions)) {
	problems.push(`versions.json has no entry for ${manifest.version} (run "npm version" / version-bump.mjs)`);
} else if (versions[manifest.version] !== manifest.minAppVersion) {
	problems.push(`versions.json[${manifest.version}] = ${versions[manifest.version]} != manifest.minAppVersion ${manifest.minAppVersion}`);
}
if (dist) {
	for (const f of ["main.js", "manifest.json", "styles.css"]) {
		if (!existsSync(resolve(dist, f))) problems.push(`release asset missing: ${dist}/${f}`);
	}
	if (existsSync(resolve(dist, "manifest.json"))) {
		const built = read(resolve(dist, "manifest.json"));
		if (built.version !== manifest.version) problems.push(`${dist}/manifest.json version ${built.version} != ${manifest.version}`);
	}
}

if (problems.length) {
	console.error("Version consistency check FAILED:");
	for (const p of problems) console.error(`  - ${p}`);
	process.exit(1);
}
console.log(`Version consistency OK: ${manifest.version} (minAppVersion ${manifest.minAppVersion})`);
