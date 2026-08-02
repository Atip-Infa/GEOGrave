## Summary

<!-- What does this PR do, and why? 2–3 sentences is enough for small changes. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor (no behaviour change)
- [ ] Database migration
- [ ] Documentation
- [ ] CI / tooling

## Related issue

<!-- Closes #NNN  or  N/A -->

## Changes

<!-- Bullet list of the key changes. Focus on the why, not the what — the diff shows the what. -->

-

## Testing

<!-- How did you verify this works correctly? Check all that apply. -->

- [ ] Existing test suite passes (`npm test`)
- [ ] Added new tests covering the change
- [ ] Manually tested locally
- [ ] Tested with Docker (`docker compose up --build`)

## Database migration

<!-- Only if this PR adds or modifies a migration file. -->

- [ ] N/A — no schema changes
- [ ] New migration file added: `backend/lib/db/migrations/NNN_description.sql`
- [ ] `docs/database.md` updated to reflect the schema change
- [ ] Migration is idempotent (`IF NOT EXISTS` guards where applicable)
- [ ] Migration runs cleanly on a fresh database (`npm test` covers this)

## Security checklist

<!-- For changes touching auth, uploads, PII, or validation. Skip if not applicable. -->

- [ ] N/A
- [ ] No new PII fields exposed to unauthenticated callers
- [ ] New file upload paths use the MIME + extension whitelist
- [ ] New endpoints have appropriate auth middleware (`requireAuth` or `attachUserIfPresent`)
- [ ] New database queries use prepared statements (no string interpolation)

## Reviewer notes

<!-- Anything you want the reviewer to pay particular attention to, or context that isn't obvious from the diff. -->
