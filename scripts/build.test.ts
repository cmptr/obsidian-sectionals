// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible build output imports compact.
import { assertReadableJavaScript, inspectUnicodeEscapes } from './build-output.ts';
import { addVersionBanner } from './build-version-banner.ts';

describe('build output scanning', () => {
  it('rejects JavaScript with dense Unicode escapes', () => {
    const source = String.raw`const hidden = '\u0068\u0069\u0064\u0065';`;

    expect(() => assertReadableJavaScript(source)).toThrow('4 Unicode escapes');
  });

  it('accepts readable Unicode and reports no escapes', () => {
    const source = 'const labels = \'straße Σ 東京\';';

    expect(inspectUnicodeEscapes(source)).toEqual({ count: 0, density: 0 });
    expect(() => assertReadableJavaScript(source)).not.toThrow();
  });
});

describe('addVersionBanner', () => {
  it('prepends the plugin name and version without changing the bundle', () => {
    const manifest = JSON.stringify({ name: 'Sectionals', version: '0.1.1' });

    expect(addVersionBanner('const plugin = true;\n', manifest)).toBe(
      '// Sectionals 0.1.1\nconst plugin = true;\n'
    );
  });
});
