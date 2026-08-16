/**
 * Common Vitest setup (all projects).
 *  - `_log()` in src/common/utils.ts prints whenever `process.env.DEBUG` is truthy. Vitest inherits the
 *    shell environment, so we remove it unless the developer explicitly asks for plugin logs with
 *    GPGCRYPT_TEST_LOG=1.
 *  - Reset mock-global state (Notice log, Platform flags, DOM) between tests.
 */
import { afterEach, beforeEach } from "vitest";

if (!process.env.GPGCRYPT_TEST_LOG) {
	delete process.env.DEBUG;
} else {
	process.env.DEBUG = "1";
}

beforeEach(async () => {
	const mock = await import("../mocks/obsidian");
	mock.__resetObsidianMock();
});

afterEach(async () => {
	const mock = await import("../mocks/obsidian");
	mock.__resetObsidianMock();
	if (typeof document !== "undefined") {
		document.body.innerHTML = "";
	}
});
