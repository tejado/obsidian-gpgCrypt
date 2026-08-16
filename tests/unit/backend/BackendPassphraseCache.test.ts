/**
 * BackendPassphraseCache (src/backend/BackendPassphraseCache.ts) — timeout validation and the expiry
 * semantics of the cached passphrase. The constructor registers a 10 s sweeper via `window.setInterval`
 * + `plugin.registerInterval`; in the node environment `window` is stubbed to globalThis and timers are faked.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BackendPassphraseCache } from "src/backend/BackendPassphraseCache";

const SWEEP_MS = 10_000;

let registerInterval: ReturnType<typeof vi.fn>;

function createCache(timeoutSeconds?: number): BackendPassphraseCache {
	const cache = BackendPassphraseCache.create({ registerInterval } as any);
	if (timeoutSeconds !== undefined) cache.setTimeout(timeoutSeconds);
	return cache;
}

beforeEach(() => {
	vi.stubGlobal("window", globalThis);
	vi.useFakeTimers();
	registerInterval = vi.fn();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("isValidTimeout", () => {
	test.each([0, 10, 300, 2_591_999])("%d s is valid", (t) => {
		expect(BackendPassphraseCache.isValidTimeout(t)).toBe(true);
	});

	test.each([
		[-1, "negative"],
		[NaN, "NaN"],
		[60 * 60 * 24 * 30, "30 days exactly (upper bound is exclusive)"],
		[2_592_001, "more than 30 days"],
		[Infinity, "Infinity"],
		[-Infinity, "-Infinity"],
	])("%s is invalid (%s)", (t) => {
		expect(BackendPassphraseCache.isValidTimeout(t)).toBe(false);
	});

	// F20: `Number("") === 0` passes here (the settings tab then clamps it to 10 s on load) — the validator
	// itself accepts 0 because 0 legitimately means "cache disabled".
	test("[F20] 0 (what Number(\"\") yields) is valid — it means \"cache disabled\"", () => {
		expect(BackendPassphraseCache.isValidTimeout(Number(""))).toBe(true);
	});
});

describe("construction", () => {
	test("create() registers the 10 s sweeper interval with the plugin", () => {
		createCache();
		expect(registerInterval).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(1);
	});

	test("starts empty", () => {
		const c = createCache();
		expect(c.hasPassphrase()).toBe(false);
		expect(c.getPassphrase()).toBeNull();
	});

	test("default timeout is 300 s (cached at 299 s, gone after 300 s + one sweep)", () => {
		const c = createCache();
		c.setPassphrase("secret");
		vi.advanceTimersByTime(299_000);
		expect(c.getPassphrase()).toBe("secret");
		vi.advanceTimersByTime(1_000 + SWEEP_MS);
		expect(c.getPassphrase()).toBeNull();
	});
});

describe("setTimeout", () => {
	test("ignores invalid values (the previous timeout stays in effect)", () => {
		const c = createCache();
		for (const bad of [-1, NaN, 60 * 60 * 24 * 30, Infinity]) {
			c.setTimeout(bad);
		}
		// still the 300 s default: caching works and survives 5 minutes minus a bit
		c.setPassphrase("secret");
		expect(c.getPassphrase()).toBe("secret");
		vi.advanceTimersByTime(299_000);
		expect(c.getPassphrase()).toBe("secret");
	});

	test("a valid value replaces the timeout", () => {
		const c = createCache(20);
		c.setPassphrase("secret");
		vi.advanceTimersByTime(20_000 + SWEEP_MS);
		expect(c.getPassphrase()).toBeNull();
	});

	test("timeout 0 disables caching: setPassphrase is a no-op", () => {
		const c = createCache(0);
		c.setPassphrase("secret");
		expect(c.hasPassphrase()).toBe(false);
		expect(c.getPassphrase()).toBeNull();
	});

	test("setting the timeout to 0 does not clear an already cached passphrase (only the sweeper clears)", () => {
		const c = createCache(60);
		c.setPassphrase("secret");
		c.setTimeout(0);
		vi.advanceTimersByTime(60 * 60 * 1000);
		// clearCache() is guarded by `timeout > 0`, so with 0 the sweeper never clears
		expect(c.getPassphrase()).toBe("secret");
	});
});

describe("set / get / has", () => {
	test("setPassphrase then getPassphrase / hasPassphrase", () => {
		const c = createCache();
		c.setPassphrase("secret");
		expect(c.hasPassphrase()).toBe(true);
		expect(c.getPassphrase()).toBe("secret");
	});

	test("a different passphrase replaces the cached one", () => {
		const c = createCache();
		c.setPassphrase("one");
		c.setPassphrase("two");
		expect(c.getPassphrase()).toBe("two");
	});

	// F20: main.ts:752 treats "" as "no passphrase" while the cache happily stores it.
	test("[F20] hasPassphrase() is true after setPassphrase(\"\") (empty string is cached)", () => {
		const c = createCache();
		c.setPassphrase("");
		expect(c.hasPassphrase()).toBe(true);
		expect(c.getPassphrase()).toBe("");
	});
});

describe("expiry (10 s sweeper)", () => {
	test("expires after timeout + one sweep", () => {
		const c = createCache(60);
		c.setPassphrase("secret");
		vi.advanceTimersByTime(60_000 + SWEEP_MS);
		expect(c.getPassphrase()).toBeNull();
		expect(c.hasPassphrase()).toBe(false);
	});

	test("not expired at timeout - 1 ms", () => {
		const c = createCache(60);
		c.setPassphrase("secret");
		vi.advanceTimersByTime(59_999);
		expect(c.getPassphrase()).toBe("secret");
	});

	test("expired exactly at the timeout when a sweep coincides with it", () => {
		const c = createCache(60); // sweeps at 10 s, 20 s, … 60 s — the 60 s sweep sees now >= lastSet + 60 s
		c.setPassphrase("secret");
		vi.advanceTimersByTime(60_000);
		expect(c.getPassphrase()).toBeNull();
	});

	// F20: getPassphrase() never checks expiry itself; only the 10 s sweeper does, so the effective lifetime
	// is anywhere between `timeout` and `timeout + 10 s` depending on phase.
	test("[F20] getPassphrase() returns an expired passphrase until the next sweep (up to 10 s late)", () => {
		const c = createCache(60);
		vi.advanceTimersByTime(5_000); // set between two sweeps → expiry at 65 s, sweeps at 60 s and 70 s
		c.setPassphrase("secret");
		vi.advanceTimersByTime(60_000 + 4_999); // now = 69 999 ms — expired since 65 s
		expect(c.getPassphrase()).toBe("secret");
		vi.advanceTimersByTime(1);
		expect(c.getPassphrase()).toBeNull();
	});

	// F20: without the interval (e.g. it was never registered / plugin unloaded) nothing ever expires.
	test("[F20] with the sweeper stopped the passphrase never expires", () => {
		const c = createCache(60);
		c.setPassphrase("secret");
		vi.clearAllTimers();
		vi.advanceTimersByTime(24 * 60 * 60 * 1000);
		expect(c.getPassphrase()).toBe("secret");
	});

	test("a passphrase set later than another one gets its own full lifetime", () => {
		const c = createCache(60);
		c.setPassphrase("one");
		vi.advanceTimersByTime(50_000);
		c.setPassphrase("two"); // different → lastSet refreshed
		vi.advanceTimersByTime(50_000); // 100 s total; "two" expires at 110 s
		expect(c.getPassphrase()).toBe("two");
		vi.advanceTimersByTime(SWEEP_MS + SWEEP_MS);
		expect(c.getPassphrase()).toBeNull();
	});

	// F20: `this.passphrase != passphrase` guards the update, so re-entering the same passphrase does not
	// bump `lastSet` — the original expiry stands.
	test("[F20] re-supplying the same passphrase does not refresh lastSet (expires on the original schedule)", () => {
		const c = createCache(60);
		c.setPassphrase("secret");
		vi.advanceTimersByTime(50_000);
		c.setPassphrase("secret"); // same value → ignored
		vi.advanceTimersByTime(SWEEP_MS); // 60 s sweep: expired on the original schedule
		expect(c.getPassphrase()).toBeNull();
	});
});

describe("resetTimeout", () => {
	test("extends the lifetime from now", () => {
		const c = createCache(60);
		c.setPassphrase("secret");
		vi.advanceTimersByTime(50_000);
		c.resetTimeout(); // new expiry: 110 s
		vi.advanceTimersByTime(50_000); // 100 s
		expect(c.getPassphrase()).toBe("secret");
		vi.advanceTimersByTime(SWEEP_MS + SWEEP_MS); // 120 s: past 110 s + sweep
		expect(c.getPassphrase()).toBeNull();
	});

	test("clears an already-expired (but not yet swept) passphrase instead of reviving it", () => {
		const c = createCache(60);
		vi.advanceTimersByTime(5_000);
		c.setPassphrase("secret"); // expires at 65 s; next sweep at 70 s
		vi.advanceTimersByTime(61_000); // now 66 s: expired, still readable (F20)
		expect(c.getPassphrase()).toBe("secret");
		c.resetTimeout();
		expect(c.getPassphrase()).toBeNull();
	});

	test("is harmless when nothing is cached", () => {
		const c = createCache(60);
		expect(() => c.resetTimeout()).not.toThrow();
		expect(c.getPassphrase()).toBeNull();
	});
});
