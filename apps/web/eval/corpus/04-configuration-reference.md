# Halogen Configuration Reference

## Precedence

Configuration is resolved in this order, highest priority first:

1. Command-line flag
2. Environment variable
3. Config file (`/etc/halogen/config.yaml`)
4. Built-in default

A value set by a CLI flag can never be overridden by an environment variable.

## Ingest settings

### HALOGEN_BATCH_SIZE

Number of events an `ingest-worker` pulls per poll.

- Default: `250`
- Maximum: `500`
- Raising this above 500 is rejected at startup.

### HALOGEN_FLUSH_INTERVAL_MS

Maximum time a partial batch waits before being flushed.

- Default: `2000`
- Lower values reduce latency and increase Kafka request volume.

### HALOGEN_IDEMPOTENCY_TTL_HOURS

How long idempotency keys are retained in Redis.

- Default: `24`
- Must match the documented API behaviour; changing it changes the public
  contract and requires an API version note.

## Ledger settings

### HALOGEN_LEDGER_POOL_MAX

Maximum Postgres connections held by `ledger-service` per pod.

- Default: `20`
- Exhausting the pool returns `HLG-4022` to clients.
- Total connections equal this value multiplied by the replica count, so raising
  it requires checking the database `max_connections` setting first.

### HALOGEN_LEDGER_COMMIT_TIMEOUT_MS

- Default: `1500`
- A commit exceeding this timeout is abandoned and retried once.

## Reconciliation settings

### HALOGEN_RECON_WINDOW_DAYS

Largest reconciliation window a caller may request.

- Default: `3`
- Maximum: `14`
- Requests above the configured value are rejected with `HLG-5003`.

## Operational settings

### HALOGEN_LOG_LEVEL

- Default: `info`
- Accepted values: `debug`, `info`, `warn`, `error`.
- `debug` logs full event envelopes and must never be enabled in production,
  because envelopes may contain untokenized PII.

### HALOGEN_S3_ARCHIVE_BUCKET

- No default. This variable is required and services refuse to start without it.
- Production value is `nw-halogen-archive`.

### HALOGEN_METRICS_PORT

- Default: `9090`
- Prometheus scrapes `/metrics` on this port.
