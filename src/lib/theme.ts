// Colors and decorative dividers. Pure functions, shared by the server page and the studio preview.

export function hexRgb(h: string): [number, number, number] {
  const x = h.replace('#', '');
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
}
export function rgbHex(a: number[]): string {
  return '#' + a.map((v) => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2)).join('');
}
export function mix(a: string, b: string, t: number): string {
  const x = hexRgb(a), y = hexRgb(b);
  return rgbHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}
/** Dark or white text, whichever reads better on this color. */
export function textOn(hex: string): string {
  const c = hexRgb(hex);
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  return L > 0.32 ? '#10161b' : '#ffffff';
}

export function themeVars(main: string, accent: string): Record<string, string> {
  return {
    '--c-main': main,
    '--c-on': textOn(main),
    '--c-deep': mix(main, '#000000', 0.8),
    '--c-lag': mix(main, '#000000', 0.62),
    '--c-ink': mix(main, '#000000', 0.88),
    '--c-muted': mix(main, '#000000', 0.7),
    '--c-foam': mix(main, '#ffffff', 0.78),
    '--c-line': mix(main, '#ffffff', 0.3),
    '--c-acc': accent,
    '--c-acc-rgb': hexRgb(accent).join(','),
    '--c-main-rgb': hexRgb(main).join(','),
  };
}

export function bannerGradient(main: string, kind: string): string {
  if (kind === 'tide') return 'linear-gradient(120deg,#023e58 0%,#0f766e 55%,#8fd3e8 100%)';
  if (kind === 'dusk') return 'linear-gradient(120deg,#1d2b53 0%,#8a2a5b 55%,#ff6b4a 100%)';
  if (kind === 'meadow') return 'linear-gradient(120deg,#12372a 0%,#436850 50%,#e9c46a 100%)';
  return `linear-gradient(120deg,${mix(main, '#000000', 0.75)} 0%,${mix(main, '#000000', 0.45)} 50%,${main} 100%)`;
}

export const GRADIENTS: [string, string][] = [['match', 'Match my color'], ['tide', 'Tide'], ['dusk', 'Dusk'], ['meadow', 'Meadow']];
export const MAIN_SWATCHES = [
  { c: '#00ffd5', n: 'Otter teal' }, { c: '#2f7bff', n: 'Ocean blue' }, { c: '#ff4fa3', n: 'Fuchsia' },
  { c: '#ff9d8a', n: 'Coral' }, { c: '#b9a4ff', n: 'Lilac' }, { c: '#ffd34d', n: 'Sunny' },
];
export const ACCENT_SWATCHES = [
  { c: '#ffffff', n: 'White' }, { c: '#ffe66d', n: 'Butter' }, { c: '#f4a31f', n: 'Stamen orange' },
  { c: '#ff8fc7', n: 'Pink' }, { c: '#b6ff5c', n: 'Lime' },
];
// 'lily' is only used by the example page, so it is not offered to creators.
export const DIVIDER_CHOICES = [
  { id: 'line', n: 'Simple line' }, { id: 'wave', n: 'Waves' }, { id: 'dots', n: 'Bubbles' },
  { id: 'stars', n: 'Sparkles' }, { id: 'none', n: 'No divider' },
];

function star(x: number, y: number, r: number, k: string): string {
  return `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="${k}"/>`;
}

/** An inline SVG data URL for the built-in dividers, drawn in the accent color. Empty for none/upload/lily. */
export function dividerDataUrl(kind: string, accent: string): string {
  const k = accent;
  const H = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 48">';
  let svg = '';
  if (kind === 'wave') svg = H + `<path d="M20 24q20-18 40 0t40 0 40 0 40 0 40 0 40 0 20 0" fill="none" stroke="${k}" stroke-width="3" stroke-linecap="round"/></svg>`;
  else if (kind === 'dots') svg = H + [[50, 28, 5], [90, 20, 3], [130, 27, 7], [160, 16, 4], [190, 27, 7], [230, 20, 3], [270, 28, 5]]
    .map((d) => `<circle cx="${d[0]}" cy="${d[1]}" r="${d[2]}" fill="none" stroke="${k}" stroke-width="2.5"/>`).join('') + '</svg>';
  else if (kind === 'stars') svg = H + star(160, 24, 15, k) + star(110, 24, 9, k) + star(210, 24, 9, k) + star(70, 24, 5, k) + star(250, 24, 5, k) + '</svg>';
  else if (kind === 'line') svg = H + `<path d="M20 24H140M180 24H300" stroke="${k}" stroke-width="3" stroke-linecap="round"/>` + star(160, 24, 11, k) + '</svg>';
  else return '';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
