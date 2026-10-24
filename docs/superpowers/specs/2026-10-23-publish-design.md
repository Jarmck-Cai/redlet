# Redlet actual publishing and target verification

User requested actual submission, result verification and one truthful developer note, with rapid tests. This extends the already established preview design. Keep TypeScript/Playwright and the current feature branch; no new platform or service. The creator account will carry AI-native creation and tool sharing, per the user; public content is a separate explicit bundle.

## Contract
- `publish <post.json> --confirm <content_id>` performs the verified preview, rechecks current text/settings/images/account immediately before the one final click, and records the outcome.
- Persist an atomic local content-id reservation before browser work, and a durable submission-attempt marker before clicking. Same ID across retries or simultaneous processes must never submit twice. A modified bundle under an old ID is refused. Preview failures before any attempt may be retried; uncertain attempts require verification, never automatic re-publication.
- Distinguish preparing, preview_failed, submitting, verification_pending, submitted_for_review, published and rejected. Uncertain submission is `submitted:null`, not false. Published requires a target-specific platform status; editor success alone only proves submission.
- `verify <content_id> --site <site>` reopens the bound account, searches published notes by the stored title and reads only the unique exact target card. Live DOM showed reviewing/rejected tabs clear the published-only search; those tabs use only an exact target-card locator after the status request completes, never a list export or other card body. Similar titles or duplicates are not enough. No full account list capture or API scraping.
- Prefer observed note links/IDs; do not invent a public URL. Store local task receipts, preserve original submission time on later checks, and leave public URL empty when unavailable.
- Keep existing preview unchanged for users. Final publication is only an explicit publish command with matching confirmation ID. Ordinary development note uses AI declaration and public visibility. No test/demo post is submitted publicly.

## Acceptance
Real Chrome fixture tests for submission once, durable attempt ordering, false success, settings changes, pending/rejected/duplicate titles, target filtering, timeouts and duplicate-process behavior; existing full suite + typecheck/build. Then one approved-scope real development note through the compiled CLI, with actual submitted time and target status recorded. If login or platform verification blocks, keep the draft and report that specific condition.

## Scope ruling after review
Global title-absence preflight removed: current-page misses cannot prove historical absence, titles need not be unique, and account-history scanning is outside target-only verification. Durable content_id reservation/attempt state is the only retry authority. All target lookup misses remain unknown and never enable another submission.
