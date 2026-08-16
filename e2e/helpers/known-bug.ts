/**
 * Mocha counterpart of Vitest's `test.fails`: the assertion is expected to FAIL. 
 * The test passes while the bug is present (and prints a reminder) and
 * FAILS once the assertion unexpectedly succeeds — i.e. when the bug got fixed and the wrapper must be removed.
 *
 *   itKnownBug("F01", "editing an encrypted note keeps ciphertext on disk", async () => { ... });
 */
export function itKnownBug(findingId: string, title: string, fn: (this: Mocha.Context) => Promise<void> | void): void {
	it(`[known bug ${findingId}] ${title}`, async function () {
		let failed: unknown = null;
		try {
			await fn.call(this);
		} catch (err) {
			// `this.skip()` inside the body must still skip (mocha signals it with a Pending error)
			if (err && typeof err === "object" && (err.constructor?.name === "Pending" || /sync skip/.test((err as Error).message ?? ""))) throw err;
			failed = err;
		}
		if (failed === null) {
			throw new Error(
				`Finding ${findingId} appears to be FIXED: "${title}" now passes. ` +
					"Replace itKnownBug(...) with it(...).",
			);
		}
		console.log(`    (known bug ${findingId} still present: ${(failed as Error).message?.split("\n")[0]})`);
	});
}
