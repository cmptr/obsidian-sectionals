export function addVersionBanner(bundle: string, manifestSource: string): string {
  const manifest: unknown = JSON.parse(manifestSource);
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new TypeError('manifest.json must contain a JSON object');
  }

  const { name, version } = manifest as Record<string, unknown>;
  if (typeof name !== 'string' || typeof version !== 'string') {
    throw new TypeError('manifest.json name and version must be strings');
  }

  return `// ${name} ${version}\n${bundle}`;
}
