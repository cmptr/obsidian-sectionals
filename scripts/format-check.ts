import { wrapCliTask } from 'obsidian-dev-utils/script-utils/cli-utils';
import { format } from 'obsidian-dev-utils/script-utils/formatters/dprint';

import { removePnpmOnlyNpmConfig } from './npm-environment.ts';

removePnpmOnlyNpmConfig();
await wrapCliTask(() => format({ paths: [], rewrite: false }));
