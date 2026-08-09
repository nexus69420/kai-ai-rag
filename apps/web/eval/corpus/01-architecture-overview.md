# Halogen Architecture Overview

Halogen is Northwind's event ingestion and payments reconciliation platform.
This document is the canonical description of its runtime topology.

## Services

Halogen is composed of five deployable services:

- `edge-gateway` — terminates TLS, authenticates API keys, and validates request
  envelopes before anything is written to a queue.
- `ingest-worker` — normalizes raw events, tokenizes PII, and publishes to the
  normalized topic.
- `ledger-service` — the only service permitted to write to the ledger database.
- `recon-engine` — matches ledger entries against settlement files from payment
  processors.
- `notify-dispatch` — delivers webhooks to customer endpoints with retries.

## Message topics

Halogen uses Kafka with three primary topics:

| Topic | Producer | Consumer | Partitions |
| --- | --- | --- | --- |
| `halogen.events.raw` | `edge-gateway` | `ingest-worker` | 64 |
| `halogen.events.normalized` | `ingest-worker` | `ledger-service` | 64 |
| `halogen.ledger.commits` | `ledger-service` | `recon-engine`, `notify-dispatch` | 32 |

## Datastores

- Postgres database `halogen_ledger` holds all committed ledger entries. It is
  the system of record.
- Redis stores idempotency keys and rate-limit counters. Redis is treated as a
  cache: losing it degrades deduplication but never corrupts the ledger.
- S3 bucket `nw-halogen-archive` stores the immutable raw event archive.

## Latency budget

The end-to-end budget from client request to durable queue write is a p99 of
250 ms. `edge-gateway` owns 80 ms of that budget; the remainder is Kafka
acknowledgement. Ledger commit is asynchronous and is not part of the 250 ms
budget.

## Retention

- Raw events remain in `halogen.events.raw` for 30 days.
- The S3 archive retains raw events for 7 years to satisfy financial audit
  requirements.
- Ledger entries in Postgres are never deleted; they are partitioned monthly.

## Regions

Halogen runs active-active in three regions: `us-east-1`, `eu-west-1`, and
`ap-southeast-1`. Ledger writes are region-pinned by the customer's assigned
home region, so a single ledger entry is only ever written by one region.

## Ownership

`ledger-service` and `recon-engine` are owned by the Payments Platform team.
`edge-gateway`, `ingest-worker`, and `notify-dispatch` are owned by the Ingest
team. Cross-team changes require a review from both owners.
