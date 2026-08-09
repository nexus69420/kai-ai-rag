# Halogen Public API Reference (v2)

Base URL: `https://api.northwind.example/v2`

## Authentication

Every request must include an `X-Halogen-Key` header. Keys are environment
scoped; a sandbox key will be rejected by production with `HLG-1001`.

Bearer tokens are not supported on the v2 API.

## POST /v2/events

Submits one or more events for ingestion.

- Maximum request payload: 512 KB.
- Maximum events per batch: 500.
- Returns `202 Accepted` with an `eventId` for each accepted event.
- Partial success is not supported: if any event in the batch fails validation,
  the entire batch is rejected.

### Idempotency

Send an `Idempotency-Key` header to make retries safe. Halogen retains
idempotency keys for 24 hours. Replaying the same key with an identical body
returns the original response. Replaying the same key with a different body
returns `409` with `HLG-3007`.

## GET /v2/events/{eventId}

Returns the stored event and its current processing state. States are
`accepted`, `normalized`, `committed`, and `failed`.

## POST /v2/reconciliations

Starts a reconciliation run. The call is asynchronous: it returns `202` with a
`reconciliationId`. Poll `GET /v2/reconciliations/{id}` for status.

The requested window may not exceed the configured reconciliation window. A
longer window is rejected with `HLG-5003`.

## GET /v2/reconciliations/{id}

Returns run status (`queued`, `running`, `succeeded`, `failed`), matched and
unmatched counts, and a signed URL for the exception report.

## Rate limits

- 2,000 requests per minute per API key.
- Burst allowance of 300 requests.
- Exceeding the limit returns `429` with a `Retry-After` header in seconds.

Rate limits are enforced per key, not per IP address.

## Pagination

List endpoints are cursor paginated. Pass `cursor` from the previous response's
`next_cursor` field. Default page size is 100 and the maximum is 1000. Offset
pagination is not available.

## Webhook signatures

`notify-dispatch` signs every webhook with HMAC-SHA256 over the raw request
body, using the customer's signing secret. The signature is sent in the
`X-Halogen-Signature` header alongside a `X-Halogen-Timestamp` header.

Reject any webhook whose timestamp is more than 300 seconds old to prevent
replay attacks.

## Webhook retries

Failed webhook deliveries are retried 6 times with exponential backoff starting
at 2 seconds and capped at 5 minutes. After the final attempt the delivery is
moved to the dead-letter queue and an alert is raised to the customer's
configured contact.
