import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex h-full min-h-screen w-full items-center justify-center bg-canvas px-6">
      <section className="w-full max-w-md border-y border-line py-6">
        <p className="ui-mono-label text-ink-tertiary">404</p>
        <h1 className="mt-2 text-xl font-semibold text-ink">Page not found</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
          The page may have moved, or the link may no longer be valid.
        </p>
        <Link href="/" className="ui-btn-primary mt-5 inline-flex gap-2">
          <ArrowLeft size={15} />
          Company dashboard
        </Link>
      </section>
    </main>
  );
}
