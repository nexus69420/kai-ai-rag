# ADR-0004: Vector store for the Halogen support assistant

- Status: Accepted
- Date: 2024-03-11
- Deciders: Payments Platform, Developer Experience
- Supersedes: ADR-0002 (in-process embeddings cache)

## Context

The Halogen support assistant answers questions over this documentation set. It
needs filtered vector search: every query is scoped to a workspace, and often to
a subset of documents. Expected corpus size at launch is roughly 400,000 chunks,
growing 20% per quarter.

## Decision

We use Qdrant as the vector store, with payload indexes on `document_id` and
`guest_id` so scoped queries stay selective.

## Alternatives considered

### pgvector

Attractive because the ledger already runs Postgres and it removes a dependency.
Rejected because HNSW index rebuild cost during bulk re-indexing blocked writes
for several minutes on our test corpus, and re-indexing is expected whenever the
chunking strategy changes.

### Pinecone

Rejected on cost. At the projected corpus size the managed tier plus cross-region
egress was roughly three times the cost of self-hosted Qdrant, and it would place
document text in a vendor we have not completed a data-processing review for.

### Elasticsearch dense vectors

Rejected because the team has no operational experience with Elasticsearch, and
introducing it would add a second cluster to on-call scope.

## Consequences

- We own Qdrant operations, including backups and version upgrades.
- Keyword search is not provided by the vector store, so a separate BM25 index is
  required for exact-token matching on error codes and configuration keys.
- Changing the embedding model requires a full re-index, because vector
  dimensionality is fixed at collection creation.
