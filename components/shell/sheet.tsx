/** The white sheet every page is written on, centred on the desk. */
export function Sheet({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1180px] flex-1 flex-col md:px-8">
      <main className={`min-w-0 flex-1 border-line bg-surface px-4 pb-16 md:border-x md:px-12 ${className}`}>{children}</main>
    </div>
  );
}
