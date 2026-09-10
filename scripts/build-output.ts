// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible TypeScript imports compact.
import type { Node, RegularExpressionLiteral } from 'typescript';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible TypeScript imports compact.
import { createSourceFile, forEachChild, isRegularExpressionLiteral, ScriptKind, ScriptTarget } from 'typescript';

const DENSITY_SCALE = 1000;
const MAX_UNICODE_ESCAPE_DENSITY = 1;
const UNICODE_ESCAPE = /\\u[\dA-Fa-f]{4}/gu;

export interface UnicodeEscapeStats {
  readonly count: number;
  readonly density: number;
}

export function assertMobileCompatibleJavaScript(source: string): void {
  const syntaxTree = createSourceFile(
    'main.js',
    source,
    ScriptTarget.ESNext,
    false,
    ScriptKind.JS
  );
  if (findRegexLookbehind(syntaxTree) !== undefined) {
    throw new Error('Built JavaScript contains unsupported regex lookbehind.');
  }
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

function findRegexLookbehind(node: Node): RegularExpressionLiteral | undefined {
  if (
    isRegularExpressionLiteral(node)
    && (node.text.includes('(?<=') || node.text.includes('(?<!'))
  ) {
    return node;
  }
  return forEachChild(node, findRegexLookbehind);
}
