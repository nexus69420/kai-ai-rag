import Link from "next/link";

export default function HomePage() {
  return (
    <main className="landing-page">
      <div className="landing-card">
        <div className="landing-mark">K</div>
        <p className="landing-kicker">Knowledge Augmented Intelligence</p>
        <h1>Hi, I&apos;m KAI.</h1>
        <p className="landing-copy">
          Upload your PDFs, retrieve page-aware evidence, and chat with grounded
          answers that cite what they used. Bring your own Gemini API key and
          switch models anytime.
        </p>
        <p className="landing-credit">Open source RAG workspace.</p>
        <div className="landing-actions">
          <a
            className="landing-link"
            href="https://github.com/nexus69420/kai-ai-rag"
            target="_blank"
            rel="noreferrer"
          >
            Contribute / repo ↗
          </a>
          <Link className="landing-start" href="/chat">
            Start chatting →
          </Link>
        </div>
      </div>
    </main>
  );
}
