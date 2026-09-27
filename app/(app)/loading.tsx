// Shown the moment a nav link is tapped, while the server renders the page.
export default function Loading() {
  return (
    <div role="status" aria-label="Memuat halaman" className="animate-pulse">
      <div className="border-b border-steel-100 bg-white px-4 py-4 lg:px-8">
        <div className="h-8 w-48 rounded bg-steel-100" />
      </div>
      <div className="space-y-4 p-4 lg:p-8">
        <div className="h-24 rounded-lg bg-steel-100" />
        <div className="h-64 rounded-lg bg-steel-100" />
      </div>
    </div>
  );
}
