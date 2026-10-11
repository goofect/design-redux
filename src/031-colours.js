/* ------------------------------------------------------------------ */
/* Colours: hex written any way, as one form, and as RGB or HSL        */
/* ------------------------------------------------------------------ */

/** "#abc" or "#aabbcc" as six lower-case digits, or null if it's neither. */
function normalHex(value) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value || '').trim());
  if (!m) return null;
  const d = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return '#' + d.toLowerCase();
}

function hexToRgb(value) {
  const hex = normalHex(value);
  if (!hex) return null;
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function hexToHsl(value) {
  const rgb = hexToRgb(value);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}
