import { VideoCamera, X } from "@phosphor-icons/react";

// A compact segmented button used across the control rows.
export function Seg({ active, children, ...props }) {
  return (
    <button
      {...props}
      className={`flex-1 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition ${
        active
          ? "border-brand bg-brand text-white shadow-sm shadow-brand/25"
          : "border-line-strong bg-surface text-muted hover:border-brand/60 hover:text-brand"
      }`}
    >
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-10 rounded-full border transition ${
        checked ? "border-brand bg-brand" : "border-line-strong bg-canvas"
      }`}
    >
      <span
        className={`absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-all ${
          checked ? "left-[20px]" : "left-[2px]"
        }`}
      />
    </button>
  );
}

export function Slider({ label, value, min, max, step, fmt, onChange }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">{label}</span>
        <span className="text-[11px] tabular-nums text-muted">{fmt ? fmt(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-brand"
      />
    </div>
  );
}

// Button label while an export runs: render + upload progress, then encoding.
export function ExportState({ rec, fmt, progress }) {
  if (rec === "rendering") {
    return <><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-current" /> Rendering frames… {Math.round(progress * 100)}%</>;
  }
  if (rec === "encoding") {
    return <><VideoCamera size={16} weight="fill" className="animate-pulse" /> Encoding .{fmt}…</>;
  }
  return <><X size={16} /> Export failed</>;
}
