export default function Section({ icon: Icon, title, sub, children }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={18} weight="bold" className="text-brand" />
        <h2 className="text-[17px] font-semibold tracking-tight text-ink">{title}</h2>
      </div>
      {sub && <p className="mb-4 max-w-2xl text-[13px] leading-relaxed text-muted">{sub}</p>}
      {children}
    </section>
  );
}
