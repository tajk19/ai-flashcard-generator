# Security review — 2026-09-13, release 0.3.3

Scope: first-party TypeScript/CSS, Gemini transport, generated Markdown, file creation, settings storage, runtime dependencies and release tooling. Compared with the previously shipped 0.3.2 design; includes verification of fixes retained from an interrupted work session. This is a source review and regression exercise, not an independent penetration test or a guarantee of no vulnerabilities.

## Findings and corrections

| Finding | Impact / classification | Correction |
| --- | --- | --- |
| Server-provided error messages could be reflected into UI/errors | Potential disclosure of echoed note text or credentials; medium hardening priority | Show locally generated status messages; do not parse or display provider error bodies. |
| Response limits applied only to selected model text | Large surrounding JSON could bypass the intended application limit | Check the entire successful response before `JSON.parse`, then validate the extracted payload/fields. |
| Hanging transport and ambiguous automatic retries | A stuck modal or repeated charge after a lost response; reliability/cost risk | 90-second timeout, cancellation guards, no automatic retry on lost connection or timeout. |
| Output could target hidden or custom configuration folders | Unintended files in plugin/configuration space | Reject hidden segments, traversal and the actual `vault.configDir` before requesting/saving. |
| Unknown saved setting fields survived round trips | Accidental persistence of legacy secret fields | Allowlist typed non-secret settings; store only a Secret Storage identifier. |
| Generated links, embeds and HTML were not all inert | Untrusted clickable navigation/action links in a generated note | Escape HTML, embeds, Markdown/wikilink syntax and tags. Preserve intended text/emphasis/code; generate only the source link through Obsidian. |
| Competing separator could form at the content boundary | Wrong card direction/splitting; integrity bug | Check all configured inline separators and isolate boundaries. |
| Rapid/queued actions could create overlapping workflows | Duplicate calls/writes; reliability/cost risk | Guard workflow launch, phase transitions and closed/unloaded states. |
| Edited fields could rely only on textarea limits | Oversized data if a control path bypassed the UI cap | Recheck preview quality and field sizes in the writer before any mutation. |
| Character count alone did not respect UTF-8 filesystem limits | A paid generation could fail on a Linux/mobile filename | Validate 240-byte basenames and 255-byte folder components, with collision suffix space. |
| CI detected a new moderate `@vitest/mocker` path-traversal advisory after the first local audit | Development/test tooling risk; the plugin runtime bundle was not affected | Upgrade Vitest to 5.0.0 and esbuild to 0.28.2, regenerate the lockfile, and rerun the complete check and audit. |

No confirmed arbitrary-code execution vulnerability was found in the reviewed first-party code. Runtime output is bundled first-party code with `obsidian` as the only external import. There is no eval, shell command execution, remote script loading or telemetry in plugin runtime code.

## Verification

- `npm audit --json`: 0 reported vulnerabilities across the updated 102-package locked dependency graph, including development tooling, on 2026-09-13. The first GitHub CI run exposed a newly published moderate Vitest advisory; the dependencies were upgraded and the clean audit was repeated. Advisory coverage can change; this is not proof that dependencies have no defects.
- `npm run check`: 80 unit/mock regressions passed; strict TypeScript passed.
- Release verifier: manifest/package/lock versions match; `isDesktopOnly` is false; main.js matches a fresh browser-targeted bundle; only `obsidian` is an external import; basic credential-pattern scan passed.
- Responsive browser simulation uses the production workflow and CSS with a small Obsidian UI mock. At a 320 × 720 viewport it verified a scrollable setup screen, a 50-card preview with touch-sized sticky actions, English pair selection, editing, disabled Create when empty, selected-only saving, and that a response arriving 30 seconds after cancellation neither reopens the modal nor creates a file.
- No real API key or private note was used during testing.

## Residual limits and trust boundaries

- `requestUrl` buffers the HTTP transport before this plugin receives it. The 1 MiB check bounds application parsing, not peak network-buffer allocation. Cancellation/timeout discards a late result but cannot revoke a request already sent to Google or guarantee no charge.
- An explicit 429/5xx response may be retried up to three times; Google determines processing and billing. No automatic retries follow ambiguous connection failures or timeouts.
- Secret Storage is provided by Obsidian. Other installed plugins and a compromised operating system are outside this plugin's security boundary. Do not assume isolation between community plugins.
- Evidence matching is a substring/normalization check, not semantic verification. Prompt injection can degrade card quality. The model has no tools and cannot pick the output path or execute code; human preview remains mandatory. A user can explicitly choose a warned card.
- Closing setup/generation/preview does not save cards. After explicit Create and dispatch of `vault.create`, the write is already committed; closing cannot undo it. Unload/close prevents further work and UI reopening. A folder created before cancellation may remain empty.
- File writes use Obsidian's vault APIs. External filesystem mutation, symlinks outside the vault, sync engines and malicious plugins are not contained by this plugin. Existing decks are never deliberately overwritten.
- SR runtime settings access is guarded but relies on its internal data layout; a saved-data/default fallback exists. If auto-detection falls back to defaults, users must verify their settings.
- Linux native Obsidian, Android and iOS device tests and a live Gemini request are pending. The CI matrix is prepared, but a Linux job result is only available after publishing the repository and running Actions.

The package is a release candidate until native-device checks and community review are completed. See [installation and device checks](INSTALLATION.md).

