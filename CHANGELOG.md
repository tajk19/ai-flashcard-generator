# Changelog

## 0.3.5

- Replace the beta Interactions request with the standard `generateContent` endpoint for more reliable mobile requests.
- Keep structured JSON output, the 8,192-token limit, cancellation, bounded responses, retries, and safe error-code diagnostics.
- Report safe completion reasons such as `MAX_TOKENS` without reflecting provider-controlled messages.

## 0.3.4

- Show the safe machine-readable Gemini error code together with the HTTP status in the generation dialog.
- Recognize both Interactions API error codes and nested Google `ErrorInfo.reason` values such as `API_KEY_INVALID`.
- Keep provider messages private so an echoed note, prompt, or credential cannot be reflected into the UI.

## 0.3.3

- Add a ribbon command and responsive settings/preview layouts for phones and tablets, including touch targets and a sticky preview action bar.
- Keep one browser-compatible bundle for Windows, macOS, Linux, Android and iOS. Fail the build on accidental Node.js/Electron imports.
- Validate UTF-8 filename limits before generation, reserve space for collision suffixes, and reject hidden/config-directory destinations.
- Bound complete successful HTTP responses before JSON parsing; enforce a 90-second request timeout and ignore late results.
- Do not echo provider-controlled error text or retry ambiguous network failures/timeouts automatically.
- Validate saved settings through an allowlist and prevent duplicate workflow launches or queued actions after close.
- Neutralize generated Markdown links in addition to HTML, embeds and tags; validate both inline separators at content boundaries.
- Enforce field size limits again after editing and before writing a deck.
- Add security regression tests, a reproducible release verification command, and Linux/Windows CI.
- Document privacy, cancellation boundaries, installation and remaining native-device checks.

## 0.3.2

- Detect the single-line basic and reversed separators from the active Spaced Repetition plugin, with a saved-data fallback and canonical `::` / `:::` defaults.
- Replace the old single separator field with automatic synchronization plus an explicit two-separator manual override.
- Save English vocabulary pairs with Spaced Repetition's native reversed separator so every pair is reviewed in both directions.
- Update the English prompt to return one English/translation JSON pair and explicitly avoid duplicate swapped cards.
- Escape both configured inline separators inside generated content, including C++ syntax such as `std::move`, while keeping the intended delimiter unique.
- Add compatibility, routing, bidirectional serialization, and deck-writing regression tests.

## 0.3.1

- Keep the generation command visible in the command palette even while Settings or another non-editor view is focused.
- Resolve the active Markdown editor when the command runs and show a clear notice when no Markdown note is open.

## 0.3.0

- Use a non-empty editor selection as the source, falling back to the editor's current full text, including unsaved changes.
- Add a single multi-step workflow for setup, cancellable generation, review, and explicit saving.
- Require a short verbatim `evidence` quote for every generated card and verify it locally after Unicode, case, and whitespace normalization.
- Add an editable preview with selection controls and `Supported`, `Not grounded`, `Duplicate`, `Conflict`, `Too long`, and `Edited` quality labels.
- Save only cards explicitly selected in the preview; evidence remains review-only and is not written to Markdown.
- Add source, prompt, response, and generated-field limits without silent truncation, plus `max_output_tokens: 8192` for Gemini.
- Preserve the user's exact deck tag instead of forcing a `flashcards/` prefix.
- Add a configurable literal basic-card separator and escape occurrences of that separator inside card content.
- Validate the destination before the API request, preview the collision suffix, and retry with the next free suffix if a file race occurs.
- Align compatibility documentation with the canonical Spaced Repetition `1.15.4` upstream.

## 0.2.0

- Add built-in prompt profiles for atomic notes and English vocabulary or phrase translation.
- Add a persistent custom prompt with `{{count}}` and `{{targetLanguage}}` variables.
- Add a per-run generation dialog for the prompt profile, card limit, and relevant prompt parameters.
- Let the user name each output Markdown file before generation.
- Sanitize user-supplied names and keep collision-safe `(2)`, `(3)` suffixes without overwriting decks.

## 0.1.0

- Initial MVP.
- Generate atomic basic flashcards from the active Markdown note with Gemini.
- Create Spaced Repetition-compatible Markdown decks.
- Store API keys through Obsidian Secret Storage.
- Validate structured output and avoid overwriting existing decks.
- Neutralize unintended deck tags, raw HTML, and embeds in generated card text.
