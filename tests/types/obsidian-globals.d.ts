/**
 * Type-check support for the tests: `tests/tsconfig.json` maps the module name `obsidian` to our
 * runtime mock (so tests see the mock's test-only helpers with proper types), but the plugin sources
 * also rely on the GLOBAL augmentations Obsidian's typings declare (`HTMLElement.createEl/empty/show`,
 * `Array.first`, …). Referencing the real declaration file by PATH keeps those globals available
 * without affecting how the bare `obsidian` module specifier resolves. Runtime polyfills for the same
 * helpers live in `tests/setup/dom.ts`.
 */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- a path reference is exactly what we need here (see above)
/// <reference path="../../node_modules/obsidian/obsidian.d.ts" />
export {};
