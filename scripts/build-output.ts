import type { Node } from 'typescript';

import {
  createSourceFile,
  forEachChild,
  isCallExpression,
  isIdentifier,
  isNewExpression,
  isNoSubstitutionTemplateLiteral,
  isRegularExpressionLiteral,
  isStringLiteral,
  ScriptKind,
  ScriptTarget,
  transpileModule
} from 'typescript';

const DENSITY_SCALE = 1000;
const MAX_UNICODE_ESCAPE_DENSITY = 1;
const UNICODE_ESCAPE = /\\u[\dA-Fa-f]{4}/gu;

export interface UnicodeEscapeStats {
  readonly count: number;
  readonly density: number;
}

export function assertMobileCompatibleJavaScript(source: string): void {
  const transpileResult = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ESNext },
    fileName: 'main.js',
    reportDiagnostics: true
  });
  if ((transpileResult.diagnostics?.length ?? 0) > 0) {
    throw new Error('Built JavaScript is invalid JavaScript.');
  }
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

function containsRegexLookbehind(pattern: string, startIndex = 0, shouldStopAtDelimiter = false): boolean {
  let isInsideCharacterClass = false;
  let isEscaped = false;
  for (let index = startIndex; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (character === '\\') {
      isEscaped = true;
      continue;
    }
    if (character === '[') {
      isInsideCharacterClass = true;
      continue;
    }
    if (character === ']' && isInsideCharacterClass) {
      isInsideCharacterClass = false;
      continue;
    }
    if (shouldStopAtDelimiter && character === '/' && !isInsideCharacterClass) {
      return false;
    }
    if (
      !isInsideCharacterClass
      && (
        pattern.startsWith('(?<=', index)
        || pattern.startsWith('(?<!', index)
      )
    ) {
      return true;
    }
  }
  return false;
}

function findRegexLookbehind(node: Node): Node | undefined {
  const staticPattern = getStaticRegExpPattern(node);
  if (
    (isRegularExpressionLiteral(node) && containsRegexLookbehind(node.text, 1, true))
    || (staticPattern !== undefined && containsRegexLookbehind(staticPattern))
  ) {
    return node;
  }
  return forEachChild(node, findRegexLookbehind);
}

function getStaticRegExpPattern(node: Node): string | undefined {
  if (
    (!isCallExpression(node) && !isNewExpression(node))
    || !isIdentifier(node.expression)
    || node.expression.text !== 'RegExp'
  ) {
    return undefined;
  }

  const pattern = node.arguments?.[0];
  if (pattern === undefined || (!isStringLiteral(pattern) && !isNoSubstitutionTemplateLiteral(pattern))) {
    return undefined;
  }
  return pattern.text;
}
