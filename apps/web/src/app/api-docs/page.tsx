import Link from "next/link";

import { buildOpenApiSpec } from "@/lib/openapi";

export const metadata = {
  title: "KAI API reference",
  description: "OpenAPI reference for the KAI hybrid-retrieval RAG API.",
};

type Operation = {
  tags?: readonly string[];
  summary?: string;
  description?: string;
  requestBody?: unknown;
  responses?: Record<string, { description?: string }>;
};

export default function ApiDocsPage() {
  const spec = buildOpenApiSpec() as unknown as {
    info: { title: string; version: string; description: string };
    paths: Record<string, Record<string, Operation>>;
  };

  const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({
      path,
      method: method.toUpperCase(),
      operation,
    })),
  );

  return (
    <main className="docs-page">
      <div className="docs-card">
        <div className="eyebrow">Reference</div>
        <h1>{spec.info.title}</h1>
        <p className="lead">{spec.info.description}</p>

        <div className="docs-actions">
          <Link href="/api/openapi">Download OpenAPI 3.1 spec</Link>
          <Link href="/chat">Back to workspace</Link>
        </div>

        <p className="hint">
          Authenticate with an <code>x-api-key</code> header, or configure a
          server-side <code>GOOGLE_API_KEY</code>. Requests are scoped to the
          workspace in the <code>kai_guest_id</code> cookie.
        </p>

        {operations.map(({ path, method, operation }) => (
          <section className="docs-op" key={`${method}-${path}`}>
            <header>
              <span className="docs-method" data-method={method}>
                {method}
              </span>
              <code>{path}</code>
            </header>
            <h3>{operation.summary}</h3>
            {operation.description && <p>{operation.description}</p>}
            {operation.responses && (
              <ul className="docs-responses">
                {Object.entries(operation.responses).map(([code, response]) => (
                  <li key={code}>
                    <b>{code}</b> {response.description}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <section className="docs-op">
          <header>
            <span className="docs-method" data-method="POST">
              POST
            </span>
            <code>/api/chat</code>
          </header>
          <h3>Streaming chat (newline-delimited JSON)</h3>
          <p>
            Same pipeline as <code>/api/v1/ask</code>, streamed as NDJSON. Event
            types arrive in order: <code>meta</code> (chat id, sources,
            retrieval stats), repeated <code>delta</code> (answer text),
            <code> verification</code> (per-claim verdicts),{" "}
            <code>confidence</code> (composite score), then <code>done</code>.
            Errors arrive as <code>error</code>.
          </p>
        </section>
      </div>
    </main>
  );
}
