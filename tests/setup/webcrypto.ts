/**
 * OpenPGP.js v6 requires the Web Crypto API (`crypto.subtle`). jsdom's `window.crypto` only provides
 * `getRandomValues`/`randomUUID`, so under the jsdom environment we install Node's implementation.
 * (Vitest issue #5365 / jsdom issue #3455.)
 */
import { webcrypto } from "node:crypto";

const g = globalThis as { crypto?: Crypto };
if (!g.crypto || !("subtle" in g.crypto) || !g.crypto.subtle) {
	Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true, writable: true });
}
