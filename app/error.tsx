"use client";

// Shown when a page can't read the database; nothing broken is cached.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <h1 className="page-title">Something went wrong</h1>
      <p className="lede">This page couldn&apos;t load its data. Try again in a moment.</p>
      <p style={{ marginTop: "1rem" }}>
        <button type="button" onClick={reset} style={{ padding: "0.375rem 0.875rem", cursor: "pointer" }}>
          Try again
        </button>
      </p>
    </>
  );
}
