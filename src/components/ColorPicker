'use client';
import { useState } from 'react';

/** Clickable swatches plus a free color picker. Submits one value under `name`. */
export function ColorPicker({ name, label, swatches, value }: { name: string; label: string; swatches: { c: string; n: string }[]; value: string }) {
  const [v, setV] = useState(value.toLowerCase());
  return (
    <fieldset className="tier-ed"><legend>{label}</legend>
      <input type="hidden" name={name} value={v} />
      <div className="swatches" role="radiogroup" aria-label={label}>
        {swatches.map((w) => (
          <label key={w.c} className="swatch" title={w.n}>
            <input type="radio" name={`${name}-pick`} checked={v === w.c} onChange={() => setV(w.c)} />
            <span style={{ background: w.c }} /><em>{w.n}</em>
          </label>
        ))}
      </div>
      <label>Or pick any color <input type="color" value={v} onChange={(e) => setV(e.target.value.toLowerCase())} /></label>
    </fieldset>
  );
}
