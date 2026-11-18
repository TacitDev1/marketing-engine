import { Select } from "../../components/ui.jsx";

// A labelled compact dropdown for the filter row.
export function FilterSelect({ label, value, onChange, options, searchable }) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="text-faint">{label}</span>
      <Select className="min-w-[150px]" value={value} onChange={onChange} options={options} searchable={searchable} ariaLabel={label} />
    </div>
  );
}

export function BulkBtn({ onClick, danger, children }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[12px] font-medium transition ${
        danger
          ? "border-crit/40 text-crit hover:bg-crit-soft"
          : "border-line-strong bg-surface text-ink-2 hover:border-brand hover:text-brand"
      }`}
    >
      {children}
    </button>
  );
}
