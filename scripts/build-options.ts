export interface MutableBuildOptions {
  // eslint-disable-next-line obsidian-dev-utils/readonly-params-options-result-members -- The esbuild hook mutates this exact options seam.
  charset?: string;
  // eslint-disable-next-line obsidian-dev-utils/readonly-params-options-result-members, perfectionist/sort-union-types -- The esbuild hook mutates this exact options seam.
  target?: string | readonly string[];
}

// eslint-disable-next-line obsidian-dev-utils/params-options-name-match -- The shared build options seam has a brief-mandated name.
export function customizeBuildOptions(options: MutableBuildOptions): void {
  // eslint-disable-next-line unicorn/text-encoding-identifier-case -- esbuild names this option value `utf8`.
  options.charset = 'utf8';
  options.target = 'es2020';
}
