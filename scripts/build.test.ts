// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import { addVersionBanner } from './build-version-banner.ts';

describe('addVersionBanner', () => {
  it('prepends the plugin name and version without changing the bundle', () => {
    const manifest = JSON.stringify({ name: 'Sectionals', version: '0.1.1' });

    expect(addVersionBanner('const plugin = true;\n', manifest)).toBe(
      '// Sectionals 0.1.1\nconst plugin = true;\n'
    );
  });
});
