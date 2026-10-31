import { useRef, type PointerEvent } from 'react';

export function ResizeHandle({ label, axis = 'x', value, min, max, reverse = false, onChange }: { label: string; axis?: 'x' | 'y'; value: number; min: number; max: number; reverse?: boolean; onChange(value: number): void }) {
  const drag = useRef<{ position: number; value: number } | null>(null);
  const change = (n: number) => onChange(Math.round(Math.max(min, Math.min(max, n))));
  const position = (e: PointerEvent) => axis === 'x' ? e.clientX : e.clientY;
  return <div className={`resize-handle resize-${axis}`} role="separator" aria-label={label} aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} tabIndex={0}
    onPointerDown={e => { e.preventDefault(); drag.current = { position: position(e), value }; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={e => { if (drag.current) change(drag.current.value + (position(e) - drag.current.position) * (reverse ? -1 : 1)); }}
    onPointerUp={e => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={e => { const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 20 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -20 : 0; if (delta) { e.preventDefault(); change(value + delta * (reverse ? -1 : 1)); } }} />;
}
