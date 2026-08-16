import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const r = (p: string) => new URL(p, import.meta.url).pathname;

// Three projects, one config:
//   unit         node env  — pure logic (openpgp needs crypto.subtle, which jsdom breaks)
//   component    jsdom     — modals / settings tab / DOM (mocked `obsidian` module)
//   integration  jsdom     — GpgPlugin against a fake App (hook-level invariants)
export default defineConfig({
	resolve: {
		alias: [
			// The `obsidian` npm package is types-only ("main": ""); tests use our hand-rolled runtime mock.
			{ find: /^obsidian$/, replacement: r("./tests/mocks/obsidian.ts") },
			// The sources use non-relative `src/...` imports (tsconfig baseUrl ".").
			{ find: /^src\//, replacement: `${root}src/` },
		],
	},
	test: {
		restoreMocks: true,
		clearMocks: true,
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			reporter: ["text-summary", "lcov", "html"],
			reportsDirectory: "coverage",
		},
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					environment: "node",
					include: ["tests/unit/**/*.test.ts"],
					setupFiles: ["tests/setup/common.ts"],
					testTimeout: 30_000,
					hookTimeout: 30_000,
				},
			},
			{
				extends: true,
				test: {
					name: "component",
					environment: "happy-dom",
					include: ["tests/component/**/*.test.ts"],
					setupFiles: ["tests/setup/common.ts", "tests/setup/dom.ts"],
				},
			},
			{
				extends: true,
				test: {
					name: "integration",
					environment: "happy-dom",
					include: ["tests/integration/**/*.test.ts"],
					setupFiles: ["tests/setup/common.ts", "tests/setup/dom.ts", "tests/setup/webcrypto.ts"],
					testTimeout: 30_000,
					hookTimeout: 30_000,
				},
			},
		],
	},
});
