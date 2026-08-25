import { defineObsidianPluginVitestConfig } from 'obsidian-dev-utils/script-utils/test-runners/vitest-config';

export const config = defineObsidianPluginVitestConfig({
  editContext(context) {
    context.unitTests.execArgv = [];
    context.unitTests.include = ['src/**/*.test.ts', 'scripts/**/*.test.ts'];
  }
});
