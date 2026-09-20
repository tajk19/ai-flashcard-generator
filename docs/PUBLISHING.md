# Publication record — 0.3.6

Prepared on 2026-09-20 under the MIT license for the existing [GitHub repository](https://github.com/tajk19/ai-flashcard-generator) and [Obsidian Community listing](https://community.obsidian.md/plugins/ai-flashcard-generator). Release 0.3.6 replaces the rejected legacy structured-output field and adds a compatibility fallback while retaining safe diagnostics and strict local validation.

## GitHub release

1. Publish only this project, with source, lockfile, LICENSE, README, tests and workflows. Do not upload the parent workspace, vault, `data.json`, `.env`, `node_modules` or user notes.
2. Let the prepared Linux and Windows CI jobs pass. Native device testing is separate; see `INSTALLATION.md`.
3. Create a tag and release named **0.3.6** (no `v` prefix), matching `manifest.json` on the default branch.
4. Attach **main.js**, **manifest.json** and **styles.css** individually. A ZIP alone is not sufficient for Obsidian installation. The install ZIP is an optional convenience attachment.

Suggested release title: `0.3.6 — Gemini structured-output compatibility fix`.

Suggested description:

> Fixes persistent mobile `400 invalid_request` failures by replacing the legacy `responseJsonSchema` request with Gemini's current `generationConfig.responseFormat.text` contract. If a regional rollout rejects that structured-output field, the plugin retries once in JSON MIME mode and applies the same strict local response validation. Keeps the 8,192-token cap, cancellation, bounded responses and safe machine-readable diagnostics. Validated with 82 unit/mock tests, strict TypeScript, reproducible browser bundle checks and a clean dependency audit.

## Obsidian Community submission

The current official process uses [community.obsidian.md](https://community.obsidian.md), not a new PR to the old registry:

1. Sign in with the owner's Obsidian account and link the GitHub account to verify ownership.
2. Open Plugins → New plugin and supply the public repository URL.
3. Review developer policies and the maintenance commitment. The owner must approve these commitments before submission.
4. Submit; resolve automated review errors with a new incremented release. Publish once all required errors are resolved.

The public listing being submitted or published must not be confused with passing review and becoming installable inside Obsidian.

Metadata:

- ID: `ai-flashcard-generator`
- Name: `AI Flashcard Generator`
- Author: `Ramazan`
- Description: `Generate customizable Spaced Repetition flashcards from notes with Gemini.`
- Minimum Obsidian: `1.13.0`
- Desktop only: `false`

Sources rechecked on 2026-09-13: [submit a plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin), [set up and claim](https://docs.obsidian.md/community-directory/set-up-and-claim), [developer policies](https://docs.obsidian.md/community-directory/developer-policies), [submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins).
