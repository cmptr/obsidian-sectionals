// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import { removePnpmOnlyNpmConfig } from './npm-environment.ts';

const PNPM_ONLY_KEYS = [
  'npm_config__jsr_registry',
  'npm_config_store_dir',
  'npm_config_verify_deps_before_run'
] as const;

describe('removePnpmOnlyNpmConfig', () => {
  it('removes pnpm-only npm config without changing npm-compatible config', () => {
    const environment: NodeJS.ProcessEnv = {};
    for (const key of PNPM_ONLY_KEYS) {
      environment[key] = 'example';
    }
    environment['npm_config_loglevel'] = 'warn';

    removePnpmOnlyNpmConfig(environment);

    for (const key of PNPM_ONLY_KEYS) {
      expect(environment[key]).toBeUndefined();
    }
    expect(environment['npm_config_loglevel']).toBe('warn');
  });
});
