/** Nether's mark: an N whose diagonal links two notes. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#17141f" />
      <path
        d="M21 45V19L43 45V19"
        fill="none"
        stroke="#f5f1ea"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="21" cy="19" r="4.5" fill="#f2552c" />
      <circle cx="43" cy="45" r="4.5" fill="#f2552c" />
    </svg>
  );
}
