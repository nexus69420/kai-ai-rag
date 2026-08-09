# Halogen Security and Access

## API key lifecycle

API keys rotate every 90 days. A key that passes its rotation deadline is
rejected with `HLG-1002`. Rotation is self-service: create the new key, deploy
it, then revoke the old one. Overlapping validity is allowed for 7 days to make
zero-downtime rotation possible.

Keys are never logged. Any log line containing a key is treated as a security
incident.

## Access tiers

| Tier | Grants | Approval |
| --- | --- | --- |
| `read-only` | Read events, read reconciliation status | Team lead |
| `operator` | Trigger reconciliations, replay events | Team lead + service owner |
| `admin` | Rotate keys, edit customer config, ledger replay | VP approval |

Admin access is reviewed quarterly and automatically revoked after 90 days of
non-use.

## PII handling

Personally identifiable fields must be tokenized by `ingest-worker` before
anything is published to `halogen.events.normalized`. Downstream services must
never receive raw PII.

Because raw envelopes may still contain PII at the `halogen.events.raw` stage,
`HALOGEN_LOG_LEVEL=debug` is prohibited in production.

## Secrets

Secrets live in Vault under `secret/halogen/<env>`. Services read them at
startup through the Vault agent sidecar. Secrets are never baked into container
images and never stored in the config file.

## Audit logging

Every administrative action writes an audit record containing actor, action,
target, and timestamp. Audit logs are retained for 400 days and are queryable
but not mutable.

## Encryption

- All traffic uses TLS 1.3; TLS 1.2 is accepted only for legacy webhook
  receivers, and that exemption expires at the end of the current fiscal year.
- The S3 archive is encrypted with a customer-managed KMS key per region.
- Ledger data at rest is encrypted by the managed Postgres service.

## Vulnerability response

Critical vulnerabilities must be patched within 7 days of a fix being available.
High severity within 30 days. The security team tracks exceptions and reports
them monthly.
