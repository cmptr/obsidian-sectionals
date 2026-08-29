const DENSITY_SCALE = 1000;
const MAX_UNICODE_ESCAPE_DENSITY = 1;
const UNICODE_ESCAPE = /\\u[\dA-Fa-f]{4}/gu;

export interface UnicodeEscapeStats {
  readonly count: number;
  readonly density: number;
}

export function assertReadableJavaScript(source: string): UnicodeEscapeStats {
  const stats = inspectUnicodeEscapes(source);
  if (stats.density > MAX_UNICODE_ESCAPE_DENSITY) {
    throw new Error(
      `Build output contains ${String(stats.count)} Unicode escapes (${stats.density.toFixed(1)} per 1000 characters).`
    );
  }
  return stats;
}

export function inspectUnicodeEscapes(source: string): UnicodeEscapeStats {
  const count = [...source.matchAll(UNICODE_ESCAPE)].length;
  return {
    count,
    density: source.length === 0 ? 0 : count * DENSITY_SCALE / source.length
  };
}
