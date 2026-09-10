import { performance } from 'node:perf_hooks';

import type { MarkdownStructure } from '../src/markdown-structure.ts';

import { planContextualDeletionWithContext } from '../src/deletion-planner.ts';
import { parseMarkdownStructure } from '../src/markdown-structure.ts';
import { isSectionExtractionAvailableWithContext } from '../src/section-extraction-availability.ts';
import { planSectionExtraction } from '../src/section-extraction-planner.ts';
import { planSectionHierarchyChangeWithContext } from '../src/section-hierarchy-planner.ts';
import { planSectionMovementWithContext } from '../src/section-movement-planner.ts';
import { createStructuralPlanningContext } from '../src/structural-planning-context.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible fixture imports compact.
import { createPercentCommentFixture, createPlanningFixture } from './structural-planning-performance-fixtures.ts';

interface BenchmarkCase {
  readonly large: BenchmarkInput;
  readonly name: string;
  run(input: BenchmarkInput): BenchmarkRunResult;
  readonly small: BenchmarkInput;
  validateResult(
    result: BenchmarkRunResult,
    input: BenchmarkInput,
    benchmarkName: string
  ): void;
}

interface BenchmarkInput {
  readonly expectedResult: number;
  readonly label: string;
  readonly offsets?: FixtureOffsets;
  readonly size: number;
  readonly source: string;
}

interface BenchmarkResult {
  readonly largeMedianMilliseconds: number;
  readonly sizeRatio: number;
  readonly smallMedianMilliseconds: number;
  readonly timeRatio: number;
}

type BenchmarkRunResult = MarkdownStructure | number;

interface FixtureOffsets {
  readonly blockquote: number;
  readonly callout: number;
  readonly fencedCode: number;
  readonly target: number;
}

const DECIMAL_PLACE_COUNT = 3;
const EXTRACTION_AVAILABILITY_CALL_COUNT = 2;
const HALF_DIVISOR = 2;
const INPUT_ORDER_PERIOD = 2;
const KIBIBYTE = 1024;
const LARGE_PLANNING_BYTES = KIBIBYTE * KIBIBYTE;
const PERCENT_BLOCK_COUNT = 2000;
const PERCENT_SCALE_FACTOR = 2;
const SAMPLE_COUNT = 9;
const SHARED_CHECK_COUNT = 11;
const SMALL_PLANNING_KIBIBYTES = 250;
const SMALL_PLANNING_BYTES = SMALL_PLANNING_KIBIBYTES * KIBIBYTE;
const WARM_UP_ROUNDS = 3;

function assertMeasurement(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} produced an invalid measurement.`);
  }
}

function createPercentInput(blockCount: number): BenchmarkInput {
  const source = createPercentCommentFixture(blockCount);
  const byteLength = Buffer.byteLength(source, 'utf-8');
  return {
    expectedResult: blockCount,
    label: `${formatInteger(blockCount)} blocks (${formatInteger(byteLength)} bytes)`,
    size: byteLength,
    source
  };
}

function createPlanningInput(byteLength: number): BenchmarkInput {
  const source = createPlanningFixture(byteLength);
  return {
    expectedResult: 1,
    label: `${formatInteger(byteLength)} bytes`,
    offsets: getFixtureOffsets(source),
    size: byteLength,
    source
  };
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
    useGrouping: true
  }).format(value);
}

function formatMilliseconds(value: number): string {
  return `${value.toFixed(DECIMAL_PLACE_COUNT)} ms`;
}

function getFixtureOffsets(source: string): FixtureOffsets {
  return {
    blockquote: source.indexOf('blockquote cursor'),
    callout: source.indexOf('callout cursor'),
    fencedCode: source.indexOf('fenced cursor'),
    target: source.indexOf('planning target body')
  };
}

function measure(input: BenchmarkInput, benchmarkCase: BenchmarkCase): number {
  const start = performance.now();
  const result = benchmarkCase.run(input);
  const duration = performance.now() - start;
  benchmarkCase.validateResult(result, input, benchmarkCase.name);
  assertMeasurement(duration, `${benchmarkCase.name} for ${input.label}`);
  return duration;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted[Math.floor(sorted.length / HALF_DIVISOR)];
  if (middle === undefined) {
    throw new TypeError('Cannot calculate a median without samples.');
  }
  return middle;
}

function printResult(
  benchmarkCase: BenchmarkCase,
  result: BenchmarkResult
): void {
  writeOutput(`${benchmarkCase.name}:`);
  writeOutput(
    `  ${benchmarkCase.small.label}: ${formatMilliseconds(result.smallMedianMilliseconds)} median`
  );
  writeOutput(
    `  ${benchmarkCase.large.label}: ${formatMilliseconds(result.largeMedianMilliseconds)} median`
  );
  writeOutput(
    `  size ratio ${result.sizeRatio.toFixed(DECIMAL_PLACE_COUNT)}x; wall-clock ratio ${
      result.timeRatio.toFixed(DECIMAL_PLACE_COUNT)
    }x (non-blocking)`
  );
}

function requireFixtureOffsets(input: BenchmarkInput): FixtureOffsets {
  if (input.offsets === undefined) {
    throw new TypeError(`Missing precomputed fixture offsets for ${input.label}.`);
  }
  return input.offsets;
}

function runBenchmarkCase(benchmarkCase: BenchmarkCase): BenchmarkResult {
  for (let round = 0; round < WARM_UP_ROUNDS; round += 1) {
    const inputs = round % INPUT_ORDER_PERIOD === 0
      ? [benchmarkCase.small, benchmarkCase.large]
      : [benchmarkCase.large, benchmarkCase.small];
    for (const input of inputs) {
      measure(input, benchmarkCase);
    }
  }

  const largeSamples: number[] = [];
  const smallSamples: number[] = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    const isSmallFirst = sample % INPUT_ORDER_PERIOD === 0;
    const firstInput = isSmallFirst ? benchmarkCase.small : benchmarkCase.large;
    const secondInput = isSmallFirst ? benchmarkCase.large : benchmarkCase.small;
    const firstDuration = measure(firstInput, benchmarkCase);
    const secondDuration = measure(secondInput, benchmarkCase);
    if (isSmallFirst) {
      smallSamples.push(firstDuration);
      largeSamples.push(secondDuration);
    } else {
      largeSamples.push(firstDuration);
      smallSamples.push(secondDuration);
    }
  }

  const largeMedianMilliseconds = median(largeSamples);
  const smallMedianMilliseconds = median(smallSamples);
  const sizeRatio = benchmarkCase.large.size / benchmarkCase.small.size;
  const timeRatio = largeMedianMilliseconds / smallMedianMilliseconds;
  assertMeasurement(sizeRatio, `${benchmarkCase.name} size ratio`);
  assertMeasurement(timeRatio, `${benchmarkCase.name} time ratio`);
  return {
    largeMedianMilliseconds,
    sizeRatio,
    smallMedianMilliseconds,
    timeRatio
  };
}

function runContextCreation(input: BenchmarkInput): number {
  const context = createStructuralPlanningContext(input.source);
  return context.source === input.source
      && context.sections.length > 0
      && context.structure.headings.length > 0
    ? 1
    : 0;
}

function runContextSharedChecks(input: BenchmarkInput): number {
  const context = createStructuralPlanningContext(input.source);
  const offsets = requireFixtureOffsets(input);
  let successfulResults = 0;

  for (const mode of ['up', 'down', 'start', 'end'] as const) {
    if (
      planSectionMovementWithContext(context, offsets.target, {
        kind: 'move-section',
        mode
      }) !== null
    ) {
      successfulResults += 1;
    }
  }
  for (const mode of ['promote', 'demote'] as const) {
    if (
      planSectionHierarchyChangeWithContext(context, offsets.target, {
        kind: 'change-section-hierarchy',
        mode
      }) !== null
    ) {
      successfulResults += 1;
    }
  }
  for (
    const [offset, kind] of [
      [offsets.fencedCode, 'fenced-code'],
      [offsets.callout, 'callout'],
      [offsets.blockquote, 'blockquote']
    ] as const
  ) {
    if (planContextualDeletionWithContext(context, offset, kind) !== null) {
      successfulResults += 1;
    }
  }
  for (
    let index = 0;
    index < EXTRACTION_AVAILABILITY_CALL_COUNT;
    index += 1
  ) {
    if (isSectionExtractionAvailableWithContext(context, offsets.target)) {
      successfulResults += 1;
    }
  }

  return successfulResults === SHARED_CHECK_COUNT ? 1 : 0;
}

function runFullExtractionPlan(input: BenchmarkInput): number {
  const plan = planSectionExtraction(
    input.source,
    requireFixtureOffsets(input).target
  );
  return plan.kind === 'ready' ? 1 : 0;
}

function runPercentCommentParse(input: BenchmarkInput): MarkdownStructure {
  return parseMarkdownStructure(input.source);
}

function validateCountResult(
  result: BenchmarkRunResult,
  input: BenchmarkInput,
  benchmarkName: string
): void {
  if (typeof result !== 'number') {
    throw new TypeError(`${benchmarkName} returned an invalid result for ${input.label}.`);
  }
  if (result !== input.expectedResult) {
    throw new TypeError(
      `${benchmarkName} returned ${String(result)} for ${input.label}; expected ${String(input.expectedResult)}.`
    );
  }
}

function validatePercentCommentResult(
  result: BenchmarkRunResult,
  input: BenchmarkInput,
  benchmarkName: string
): void {
  if (typeof result === 'number') {
    throw new TypeError(`${benchmarkName} returned an invalid result for ${input.label}.`);
  }
  const fencedBlockCount = result.blocks.filter(
    (block) => block.kind === 'fenced-code'
  ).length;
  const protectedRangeCount = result.protectedRanges.length;
  if (
    fencedBlockCount !== input.expectedResult
    || protectedRangeCount !== input.expectedResult
  ) {
    throw new TypeError(
      `${benchmarkName} returned ${String(fencedBlockCount)} fenced blocks and ${
        String(protectedRangeCount)
      } protected ranges for ${input.label}; expected ${String(input.expectedResult)} of each.`
    );
  }
}

function writeOutput(message: string): void {
  process.stdout.write(`${message}\n`);
}

const smallPlanningInput = createPlanningInput(SMALL_PLANNING_BYTES);
const largePlanningInput = createPlanningInput(LARGE_PLANNING_BYTES);
const benchmarkCases: readonly BenchmarkCase[] = [
  {
    large: largePlanningInput,
    name: 'One structural context creation',
    run: runContextCreation,
    small: smallPlanningInput,
    validateResult: validateCountResult
  },
  {
    large: largePlanningInput,
    name: 'One context-shared 11-check batch',
    run: runContextSharedChecks,
    small: smallPlanningInput,
    validateResult: validateCountResult
  },
  {
    large: largePlanningInput,
    name: 'One full extraction plan',
    run: runFullExtractionPlan,
    small: smallPlanningInput,
    validateResult: validateCountResult
  },
  {
    large: createPercentInput(PERCENT_BLOCK_COUNT * PERCENT_SCALE_FACTOR),
    name: 'Percent-comment parsing',
    run: runPercentCommentParse,
    small: createPercentInput(PERCENT_BLOCK_COUNT),
    validateResult: validatePercentCommentResult
  }
];

writeOutput('Structural planning performance benchmark');
writeOutput(
  'Wall-clock measurements and ratios are non-blocking release evidence; timing never determines exit status.'
);
writeOutput(
  `${String(SAMPLE_COUNT)} measured samples after ${
    String(WARM_UP_ROUNDS)
  } warm-up rounds; small/large input order alternates.`
);
for (const benchmarkCase of benchmarkCases) {
  printResult(benchmarkCase, runBenchmarkCase(benchmarkCase));
}
