# Halogen Engineer Onboarding

## Day one access

Request access with:

```bash
nw-access request halogen-dev
```

Approval is handled by your team lead and usually completes within one business
day. Production access is not granted during onboarding — see the access tiers
in the security document.

## Local development

Start the full local stack (Kafka, Postgres, Redis) with:

```bash
halogenctl dev up
```

The command seeds a sandbox API key and prints it once. Re-run
`halogenctl dev key` to print it again.

Local Kafka uses a single partition per topic, so ordering behaviour differs
from production. Never validate partition-dependent logic locally only.

## Tests

- `make test` runs unit tests. No external services required.
- `make test-integration` runs integration tests and requires Docker to be
  running.
- `make test-contract` validates the OpenAPI schema against the live sandbox.

CI runs all three on every pull request. A red integration suite blocks merge.

## Code review

Every pull request requires two approvals, and at least one must come from an
owner of the service being changed. Service ownership is listed in the
architecture overview.

Pull requests touching `ledger-service` additionally require a review from the
Payments Platform on-call engineer, because ledger changes cannot be rolled back
cleanly after 15 minutes.

## Deploy freezes

Deploys are frozen:

- Every Friday after 14:00 UTC through Monday 09:00 UTC.
- From December 20 through January 2 inclusive.

Freeze exceptions require an incident commander and a written justification in
the deploy ticket.

## Getting help

The `#halogen-help` channel is monitored during business hours in all three
regions. For anything customer-facing and urgent, page on-call rather than
posting in chat.
