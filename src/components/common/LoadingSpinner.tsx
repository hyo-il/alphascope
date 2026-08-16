export default function LoadingSpinner({ label }: { label?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-text-secondary">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}
