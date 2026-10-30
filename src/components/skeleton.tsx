import { t } from "@/lib/copy/fa";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton rounded-xl ${className}`} />;
}

export function PageSkeleton({ variant = "list" }: { variant?: "list" | "grid" }) {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <span role="status" className="sr-only">{t.pending.loading}</span>
      <Skeleton className="mb-3 h-4 w-24" />
      <Skeleton className="mb-6 h-9 w-56" />
      {variant === "grid" ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <div className="grid gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      )}
    </main>
  );
}
