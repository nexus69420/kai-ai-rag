# Halogen Error Code Catalogue

Every Halogen error response includes a stable `code` field. HTTP status alone
is not sufficient to distinguish causes; always branch on the code.

## Authentication — 1xxx

### HLG-1001 — Invalid API key

HTTP `401`. The key is unknown, malformed, or scoped to a different
environment. Not retryable.

### HLG-1002 — Expired API key

HTTP `401`. The key passed its 90-day rotation deadline. Not retryable; issue a
new key.

### HLG-1003 — Insufficient scope

HTTP `403`. The key is valid but lacks the required access tier. Not retryable.

## Validation — 2xxx

### HLG-2014 — Payload too large

HTTP `413`. The request body exceeded 512 KB. Split the batch and retry.

### HLG-2015 — Batch too large

HTTP `413`. More than 500 events in a single request.

### HLG-2021 — Schema validation failed

HTTP `400`. One or more events failed envelope validation. The response lists
the offending event indexes. The whole batch is rejected.

## Idempotency — 3xxx

### HLG-3007 — Idempotency key conflict

HTTP `409`. The same `Idempotency-Key` was reused with a different request body.
Not retryable with the same key.

## Ledger — 4xxx

### HLG-4021 — Ledger write conflict

HTTP `409`. Two writes targeted the same ledger account concurrently. Retryable:
retry with exponential backoff. This is expected under load.

### HLG-4022 — Ledger pool exhausted

HTTP `503`. `ledger-service` has no free database connections. Retryable after
the `Retry-After` interval. Sustained occurrences mean
`HALOGEN_LEDGER_POOL_MAX` or the replica count needs review.

### HLG-4030 — Region mismatch

HTTP `409`. The request reached a region that is not the customer's home region.
Clients should follow the `Location` header rather than retrying blindly.

## Reconciliation — 5xxx

### HLG-5003 — Reconciliation window exceeded

HTTP `422`. The requested window is larger than `HALOGEN_RECON_WINDOW_DAYS`.
Not retryable without shrinking the window.

### HLG-5500 — Downstream timeout

HTTP `504`. A payment processor did not respond in time. Retryable; the
reconciliation run can be resumed with the same `reconciliationId`.
