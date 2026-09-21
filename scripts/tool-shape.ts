#!/usr/bin/env tsx
/**
 * pdfnative-mcp — structural fingerprint of `tools/list`
 * ========================================================
 *   npx tsx scripts/tool-shape.ts            # print the fingerprint
 *   npx tsx scripts/tool-shape.ts --write    # refresh tests/_fixtures/tool-shape.json
 *   npx tsx scripts/tool-shape.ts --check    # exit 1 when dist/ differs from the fixture
 *
 * `tests/catalogue-parity.test.ts` asserts the live catalogue matches the
 * committed fixture, so wording can be tuned freely (descriptions, examples,
 * instructions) while any schema change must be a deliberate, reviewed
 * fixture update (docs/API_STABILITY.md §5). Run `--write` ONLY after such a
 * change, and after `npm run build`: the fingerprint is taken from `dist/`.
 *
 * Exit codes: 0 ok · 1 --check found a difference · 2 dist/ is missing or bad usage.
 */

import './helpers/hermetic.js';

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/io.js';
import { loadBuiltServer } from './helpers/server.js';
import { serializeShape, type ListedTool } from './lib/tool-shape.js';

const FIXTURE = join(REPO_ROOT, 'tests', '_fixtures', 'tool-shape.json');

async function main(): Promise<number> {
    const args = process.argv.slice(2);
    const unknown = args.find((a) => a !== '--write' && a !== '--check');
    if (unknown !== undefined || (args.includes('--write') && args.includes('--check'))) {
        process.stderr.write('Usage: npx tsx scripts/tool-shape.ts [--write | --check]\n');
        return 2;
    }
    const server = await loadBuiltServer();
    if (server === null) {
        process.stderr.write('dist/server.js not found — run `npm run build` first.\n');
        return 2;
    }
    const tools = server.listToolsPayload().tools as readonly ListedTool[];
    const json = serializeShape(tools);

    if (args.includes('--write')) {
        writeFileSync(FIXTURE, json);
        process.stdout.write(`wrote tests/_fixtures/tool-shape.json (${tools.length} tools)\n`);
        return 0;
    }
    if (args.includes('--check')) {
        const committed = existsSync(FIXTURE) ? readFileSync(FIXTURE, 'utf8').replace(/\r\n/g, '\n') : '';
        if (committed === json) {
            process.stdout.write(`tools/list matches tests/_fixtures/tool-shape.json (${tools.length} tools)\n`);
            return 0;
        }
        process.stderr.write('tools/list (dist/) differs from tests/_fixtures/tool-shape.json — see docs/API_STABILITY.md §5 before refreshing it.\n');
        return 1;
    }
    process.stdout.write(json);
    return 0;
}

process.exit(await main());
