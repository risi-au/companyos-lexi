"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--bg)] px-[var(--space-4)] text-[var(--fg)]">
      <section className="w-full max-w-md rounded-[var(--radius-4)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-6)] shadow-[var(--shadow)]">
        <div className="font-mono text-[var(--text-caption)] uppercase tracking-normal text-[var(--err)]">Error</div>
        <h1 className="mt-[var(--space-2)] text-[var(--text-page-title)] font-semibold">Something went wrong.</h1>
        <p className="mt-[var(--space-2)] text-[var(--text-body)] text-[var(--mutedfg)]">
          Sorry, CompanyOS couldn&apos;t load this view.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-[var(--space-4)] inline-flex min-h-[44px] cursor-pointer items-center rounded-[var(--radius-3)] bg-[var(--primary)] px-[var(--space-4)] text-[var(--text-body)] font-medium text-[var(--primaryfg)] hover:bg-[var(--primaryhover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
