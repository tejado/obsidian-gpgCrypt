// ESLint 9 flat config.
//
// - Base rules (errors) = default .eslintrc: eslint:recommended,
//   typescript-eslint recommended, double quotes, tab indentation, unused vars.
// - The official Obsidian plugin guideline rules (eslint-plugin-obsidianmd) are
//   applied to src/** as WARNINGS so that legacy code does not block CI; treat
//   them as a review checklist and ratchet individual rules to "error" over time.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";

/** Downgrade every rule of the given flat configs to "warn" (keeps "off"). */
function warnAll(configs) {
	return configs.map((cfg) => {
		if (!cfg.rules) return cfg;
		const rules = Object.fromEntries(
			Object.entries(cfg.rules).map(([name, value]) => {
				if (Array.isArray(value)) {
					const [severity, ...options] = value;
					return [name, severity === "off" || severity === 0 ? value : ["warn", ...options]];
				}
				return [name, value === "off" || value === 0 ? value : "warn"];
			}),
		);
		return { ...cfg, rules };
	});
}

/** Restrict flat configs to the plugin sources (drops the package.json / *.js specific entries). */
function scopeToSrc(configs) {
	return configs
		.filter((cfg) => {
			const files = cfg.files ? cfg.files.flat(2) : [];
			return !files.some((f) => f === "package.json" || f.includes("{js,cjs,mjs,jsx}"));
		})
		.map((cfg) => ({ ...cfg, files: ["src/**/*.ts"] }));
}

export default tseslint.config(
	{
		ignores: [
			"node_modules/**",
			"dist/**",
			"main.js",
			"coverage/**",
			"logs/**",
			".obsidian-cache/**",
			"e2e/vaults/**",
			"package-lock.json",
		],
	},

	js.configs.recommended,
	...tseslint.configs.recommended,

	// Official Obsidian guideline rules — src only, warnings only (see header comment).
	...scopeToSrc(warnAll(obsidianmd.configs.recommended)),
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
		},
	},

	// Repo-wide base rules (errors) — translated from the previous .eslintrc.
	{
		files: ["**/*.ts", "**/*.mts", "**/*.mjs"],
		plugins: { "@stylistic": stylistic },
		languageOptions: {
			globals: { ...globals.node, ...globals.browser },
		},
		rules: {
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
			"@typescript-eslint/ban-ts-comment": "off",
			"no-prototype-builtins": "off",
			"@typescript-eslint/no-empty-function": "off",
			"@stylistic/quotes": ["error", "double", { avoidEscape: true, allowTemplateLiterals: "always" }],
			"@stylistic/indent": ["error", "tab", { SwitchCase: 1 }],
		},
	},

	// Legacy sources and build scripts: the style rules above were never enforced before; 
	// keep them visible as warnings until `eslint --fix` has been run
	// in a dedicated commit.
	{
		files: ["src/**/*.ts", "esbuild.config.mjs", "version-bump.mjs"],
		rules: {
			"@typescript-eslint/no-unused-vars": ["warn", { args: "none" }],
			"@stylistic/quotes": ["warn", "double", { avoidEscape: true, allowTemplateLiterals: "always" }],
			"@stylistic/indent": ["warn", "tab", { SwitchCase: 1 }],
			"@typescript-eslint/no-explicit-any": "warn",
			"no-constant-condition": "warn",
			"no-async-promise-executor": "warn",
		},
	},

	// Tests, mocks and tooling: pragmatic overrides.
	{
		files: ["tests/**/*.ts", "e2e/**/*.ts", "e2e/**/*.mts", "wdio.conf.mts", "vitest.config.mts", "scripts/**/*.mjs"],
		languageOptions: {
			globals: { ...globals.node, ...globals.browser, ...globals.mocha },
		},
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-non-null-assertion": "off",
			"@typescript-eslint/no-unused-expressions": "off",
			"@typescript-eslint/no-require-imports": "off",
			"@typescript-eslint/no-namespace": "off",
			"@typescript-eslint/no-unsafe-declaration-merging": "off",
		},
	},

	// Last so it wins over the plugin configs: unused eslint-disable directives are informational.
	{
		linterOptions: { reportUnusedDisableDirectives: "warn" },
	},
);
