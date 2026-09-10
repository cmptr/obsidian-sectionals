const PLANNING_SCAFFOLD = [
  '# Planning fixture',
  'Root body for structural planning.',
  '',
  '## Flat alpha',
  'flat alpha body',
  '',
  '## Planning target',
  'planning target body',
  '',
  '### Nested target child',
  'nested target child body',
  '',
  '## Flat omega',
  'flat omega body',
  '',
  '## Protected structures',
  '```text',
  'fenced cursor',
  '# protected fenced heading',
  '```',
  '',
  '%%',
  '# protected percent heading',
  '%%',
  '',
  '> [!note] Fixture callout',
  '> callout cursor',
  '> callout body',
  '',
  '> blockquote cursor',
  '> plain blockquote body',
  ''
].join('\n');

const PLANNING_UNIT = [
  '## Repeated sibling',
  'Repeated planning body keeps fixture growth structural.',
  '',
  '### Repeated nested child',
  'Repeated nested body.',
  '',
  '```text',
  'repeated fenced body',
  '```',
  '',
  '%%',
  'repeated protected body',
  '%%',
  '',
  '> [!tip] Repeated callout',
  '> repeated callout body',
  ''
].join('\n');

const PERCENT_COMMENT_UNIT = [
  '```text',
  'protected fixture block',
  '```',
  '%%',
  'percent comment body',
  '%%',
  ''
].join('\n');

export function createPercentCommentFixture(blockCount: number): string {
  if (!Number.isSafeInteger(blockCount) || blockCount < 0) {
    throw new RangeError('Percent comment block count must be a non-negative integer.');
  }
  return PERCENT_COMMENT_UNIT.repeat(blockCount);
}

export function createPlanningFixture(byteLength: number): string {
  if (
    !Number.isSafeInteger(byteLength)
    || byteLength < PLANNING_SCAFFOLD.length
  ) {
    throw new RangeError(
      `Planning fixture byte length must be an integer of at least ${String(PLANNING_SCAFFOLD.length)}.`
    );
  }

  const availableLength = byteLength - PLANNING_SCAFFOLD.length;
  const unitCount = Math.floor(availableLength / PLANNING_UNIT.length);
  const paddingLength = availableLength - unitCount * PLANNING_UNIT.length;
  return PLANNING_SCAFFOLD
    + PLANNING_UNIT.repeat(unitCount)
    + 'p'.repeat(paddingLength);
}
