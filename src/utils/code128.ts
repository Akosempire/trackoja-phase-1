/**
 * Code 128 barcodes as SVG, for shelf and product labels. Set B covers
 * printable ASCII (space to ~), which every SKU and barcode we generate fits;
 * long numbers use set C. Checked in tests/labels.test.ts, and by decoding a printed label.
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232',
];
const STOP = '2331112';
const START_B = 104;
const START_C = 105;
const CODE_B = 100; // switch from set C to set B

/** Can this text be printed as Code 128 set B? */
export const isCode128B = (text: string) => text.length > 0 && text.length <= 48 && /^[\x20-\x7e]+$/.test(text);

/**
 * Symbol values with the check digit (start + Σ value × position, mod 103).
 * All-digit codes (EAN/UPC numbers, generated codes) use set C, two digits per
 * symbol, so they stay short enough to scan on a 50 mm label; an odd last
 * digit switches to set B. Anything else is set B.
 */
export function code128Values(text: string): number[] {
  if (!isCode128B(text)) throw new Error('Barcodes can only use letters, numbers and common symbols');
  let data: number[];
  let start = START_B;
  if (/^\d{4,}$/.test(text)) {
    start = START_C;
    const even = text.length - (text.length % 2);
    data = [];
    for (let i = 0; i < even; i += 2) data.push(Number(text.slice(i, i + 2)));
    if (even < text.length) data.push(CODE_B, text.charCodeAt(even) - 32);
  } else {
    data = Array.from(text, (ch) => ch.charCodeAt(0) - 32);
  }
  const check = data.reduce((sum, v, i) => sum + v * (i + 1), start) % 103;
  return [start, ...data, check];
}

/** Module widths, bars and spaces alternating, starting with a bar; ends with the stop pattern. */
export function code128Widths(text: string): number[] {
  const widths = code128Values(text).flatMap((v) => Array.from(PATTERNS[v], Number));
  return [...widths, ...Array.from(STOP, Number)];
}

/** "1101001000…" (1 = bar), handy for tests. */
export function code128Bits(text: string): string {
  return code128Widths(text).map((w, i) => (i % 2 === 0 ? '1' : '0').repeat(w)).join('');
}

/** An SVG barcode with 10-module quiet zones; `height` in modules. */
export function code128Svg(text: string, { height = 50, module = 1 }: { height?: number; module?: number } = {}): string {
  const widths = code128Widths(text);
  const quiet = 10;
  let x = quiet;
  const rects: string[] = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) rects.push(`<rect x="${x * module}" y="0" width="${w * module}" height="${height * module}"/>`);
    x += w;
  });
  const total = (x + quiet) * module;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height * module}" preserveAspectRatio="none" shape-rendering="crispEdges" fill="#000">${rects.join('')}</svg>`;
}
