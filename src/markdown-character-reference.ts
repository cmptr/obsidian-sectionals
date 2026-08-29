import { CHARACTER_ENTITIES } from './character-entities.ts';

const DECIMAL_RADIX = 10;
const HEXADECIMAL_ENTITY_PREFIX = '#x';
const HEXADECIMAL_RADIX = 16;
const NUMERIC_ENTITY_PREFIX = '#';

export function decodeMarkdownCharacterReference(reference: string): string {
  const referenceBody = reference.slice(1, -1);
  if (
    referenceBody.toLowerCase().startsWith(HEXADECIMAL_ENTITY_PREFIX)
  ) {
    return decodeNumericCharacterReference(
      referenceBody.slice(HEXADECIMAL_ENTITY_PREFIX.length),
      HEXADECIMAL_RADIX
    );
  }
  if (referenceBody.startsWith(NUMERIC_ENTITY_PREFIX)) {
    return decodeNumericCharacterReference(
      referenceBody.slice(NUMERIC_ENTITY_PREFIX.length),
      DECIMAL_RADIX
    );
  }
  return CHARACTER_ENTITIES[referenceBody] ?? reference;
}

// Validity ranges follow micromark-util-decode-numeric-character-reference 2.0.2 (MIT).
/* eslint-disable no-magic-numbers -- Numeric character-reference ranges are defined by HTML and CommonMark. */
function decodeNumericCharacterReference(value: string, radix: number): string {
  const codePoint = Number.parseInt(value, radix);
  if (
    codePoint < 9
    || codePoint === 11
    || (codePoint > 13 && codePoint < 32)
    || (codePoint > 126 && codePoint < 160)
    || (codePoint > 55_295 && codePoint < 57_344)
    || (codePoint > 64_975 && codePoint < 65_008)
    || codePoint % 65_536 === 65_535
    || codePoint % 65_536 === 65_534
    || codePoint > 1_114_111
  ) {
    return '\u{FFFD}';
  }

  return String.fromCodePoint(codePoint);
}
/* eslint-enable no-magic-numbers -- Re-enable outside specification-defined ranges. */
