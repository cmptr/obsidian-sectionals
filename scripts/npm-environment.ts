import process from 'node:process';

const PNPM_ONLY_NPM_CONFIG_KEYS = [
  'npm_config__jsr_registry',
  'npm_config_store_dir',
  'npm_config_verify_deps_before_run'
] as const;

export function removePnpmOnlyNpmConfig(
  environment: NodeJS.ProcessEnv = process.env
): void {
  for (const key of PNPM_ONLY_NPM_CONFIG_KEYS) {
    Reflect.deleteProperty(environment, key);
  }
}
