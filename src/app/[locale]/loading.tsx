export default function Loading() {
  return (
    <div className="grid" style={{ marginTop: 32 }} aria-busy="true" aria-label="Loading">
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}
