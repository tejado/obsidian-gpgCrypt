# Unit / component / integration tests (Vitest)

Layout (see `vitest.config.mts`, three projects):

| dir | env | what |
|---|---|---|
| `tests/unit/**` | node | pure logic: backends (openpgp / gpg wrapper), cache, validators, utils, settings |
| `tests/component/**` | happy-dom | modals, `SettingsTab`, `InputListSetting`/`ErrorTextInput`, status bar DOM |
| `tests/integration/**` | happy-dom | the real `GpgPlugin` booted against a fake `App` (`tests/helpers/plugin-harness.ts`) |

Run: `npm test` · `npm run test:unit|component|integration` · `npm run test:coverage` · `npx vitest run tests/…/x.test.ts`
Plugin debug output: `GPGCRYPT_TEST_LOG=1 npm test`.

## Conventions

* **No production changes for tests.** Everything is testable through the module alias / fakes below.
* **Known bugs are encoded as `test.fails(...)`** with the finding id in the
  title, e.g. `test.fails("[F01] editing an encrypted note …", …)`. Such a test *passes while the bug exists*
  and fails once the assertion holds — the signal to fix the finding entry and turn it into a normal `test`.
  Never "fix" the assertion of a `[Fxx]` test to make it pass.
* Tests are written against observable behaviour (disk content, DOM, Notice log, promise results), not
  implementation details, so they survive refactors of `src/`.

## The `obsidian` mock (`tests/mocks/obsidian.ts`)

`import … from "obsidian"` inside `src/` resolves to this hand-rolled runtime (the npm package is types-only).
It implements exactly what gpgCrypt uses: `Plugin`, `Modal`, `PluginSettingTab`, `Setting` + `Text/Toggle/
Dropdown/ButtonComponent`, `Notice`, `TFile/TFolder`, `Events`, `Menu`, `MarkdownView`, `Platform`,
`normalizePath`, `setIcon`. Test-only members are suffixed `__`:

* `Notice.log` / `Notice.messages()` — every Notice since the last test.
* `Modal.opened__` — modals opened since the last test; `modal.isOpen__`.
* `Plugin`: `__data` (in-memory data.json), `commands__`, `settingTabs__`, `statusBarItems__`, `extensions__`.
* Components: `TextComponent.simulateChange__(v)`, `ToggleComponent.simulateClick__()`,
  `DropdownComponent.simulateChange__(v)` / `options__()`, `ButtonComponent.simulateClick__()`.
  `setValue()` never fires `onChange` (like Obsidian); user interaction (events) does.
* `Setting.name__()`, `setting.component__(TextComponent)`.
* `Menu.titles__()`, `menu.item__("Title")?.trigger__()`.
* `Platform` is a mutable object (e.g. `Platform.isMobile = true`), reset after each test.
* Modal DOM: `.modal-container > .modal-bg + .modal > (.modal-close-button, .modal-header > .modal-title, .modal-content)`
  and it is appended to `document.body` on `open()`.

DOM helpers Obsidian adds to `HTMLElement.prototype` (`createEl`, `createDiv`, `empty`, `addClass`, `setText`,
`show/hide`, …) are polyfilled by `tests/setup/dom.ts`. `show()`/`hide()` toggle `style.display`.

## The fake App (`tests/mocks/fake-app.ts`)

`createFakeApp({ files, folders }, { withoutFileRecovery })` →
`FakeApp { vault: FakeVault, workspace: FakeWorkspace, fileManager, internalPlugins.plugins["file-recovery"], setting, fileRecovery }`

* `app.vault.adapter.files: Map<path, content>` is "the disk" (bypasses all hooks); `adapter.writes[]` logs writes.
* `vault.read/cachedRead/modify/process/create/rename/delete` route through `adapter.*` **looked up at call time**,
  so the plugin's instance-level hooks apply exactly like in Obsidian; `modify` triggers `"modify"`.
* `vault.seed__({path: content})`, `vault.getFileByPath(p)`, `vault.getFolderByPath(p)`, `vault.seedFolders__([...])`.
* `workspace.setActiveFile__(file)` (fires `"file-open"`, creates a `MarkdownView` as active view),
  `workspace.setLayoutReady__()` runs queued `onLayoutReady` callbacks.
* `app.fileRecovery.onFileChanged` / `.forceAdd` are `vi.fn`s that snapshot via `vault.cachedRead`
  (`app.fileRecovery.snapshots`), pre-registered on vault `"modify"` / workspace `"file-open"` like Obsidian.
* `app.setting.open/openTabById` are `vi.fn`s.

## The plugin harness (`tests/helpers/plugin-harness.ts`)

```ts
const h = await createPluginHarness({
  keys: "nopass" | "pw" | null,   // fixture key pair copied to public.asc/private.asc (default nopass)
  files: { "Encrypted.md": CIPHERTEXT_NOPASS },
  settings: { encryptAll: true },  // merged over the plugin defaults; firstLoad=false unless set
  layoutReady: true,               // run onLayoutReady (loadKeypair, first-run modal, startup passphrase)
  withoutFileRecovery: false,
});
h.app, h.plugin, h.disk("Encrypted.md"), h.settings(), h.savedData(); await h.unload();
```
Fixtures: `tests/helpers/fixtures.ts` → `KEYS.nopass/pw` (armored keys, `passphrase`, `keyId`, `fingerprint`),
`PLAINTEXT` ("Hello secret world\n"), `CIPHERTEXT_NOPASS`, `CIPHERTEXT_PW`, `GPG_LIST_KEYS_COLONS`,
`isArmoredMessage()`. Keys are TEST-ONLY (`scripts/gen-test-fixtures.mjs`), legacy-curve so real gpg can use them.

## Faking `child_process` (`tests/mocks/fake-child-process.ts`)

```ts
import { fakeSpawn } from "../../mocks/fake-child-process";
vi.mock("child_process", () => ({ spawn: fakeSpawn.spawn }));   // must be in the test file (hoisted)
fakeSpawn.script((exec, args) => ({ stdout: "…", stderr: "…", code: 0, error, waitForStdinEnd, hang, delayMs }));
fakeSpawn.calls / fakeSpawn.lastCall → { exec, args, process: { stdinData, stdinEnded, kill } }
```
Real-gpg tests (`*.gpg.test.ts`) run only with `GPG_INTEGRATION=1` and an isolated `GNUPGHOME`.
