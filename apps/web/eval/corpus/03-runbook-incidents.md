# Halogen Incident Runbook

## Severity definitions

| Severity | Definition | Acknowledgement target |
| --- | --- | --- |
| Sev1 | Customer-facing outage or ledger correctness risk | 5 minutes |
| Sev2 | Degraded processing, no data loss | 15 minutes |
| Sev3 | Internal-only impact or cosmetic defect | Next business day |

Only an incident commander may change the severity of an active incident.

## Escalation path

The primary on-call engineer is paged first. If the page is not acknowledged
within 10 minutes it escalates to the secondary on-call. If the secondary does
not acknowledge within a further 25 minutes, the engineering manager for the
owning team is paged directly.

## Rollback procedure

Roll back with:

```bash
halogenctl deploy rollback --service <name> --to <revision>
```

A rollback is only safe within 15 minutes of the deploy that introduced the
regression. After 15 minutes, `ledger-service` may have committed entries under
the new schema, and rollback requires a ledger replay coordinated with the
Payments Platform team.

Never roll back `ledger-service` and `recon-engine` independently — they share
the commit schema and must be moved together.

## Queue backlog

If consumer lag on `halogen.events.raw` exceeds 100,000 messages:

1. Confirm `ingest-worker` pods are healthy and not crash-looping.
2. Scale `ingest-worker` to 40 replicas:
   `halogenctl scale --service ingest-worker --replicas 40`.
3. If lag is still growing after 10 minutes, raise a Sev2 and page the Ingest
   team lead.

Do not scale beyond 40 replicas without Payments Platform approval: the ledger
connection pool becomes the bottleneck and clients begin receiving `HLG-4022`.

## Ledger write conflicts

A burst of `HLG-4021` indicates concurrent writes to the same ledger account.
This is expected under load and clients should retry with backoff. Sustained
rates above 5% of ledger writes for more than 10 minutes warrant a Sev2.

## Postmortems

Every Sev1 and Sev2 requires a written postmortem within 5 business days.
Postmortems are blameless and must include a timeline, contributing factors, and
at least one action item with a named owner.
