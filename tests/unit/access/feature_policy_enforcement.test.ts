import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ComponentPolicy } from '../../../src/access/components_policy';
import { CommandPolicy } from '../../../src/access/features';

const projectRoot = join(__dirname, '../../..');

function source(path: string): string {
  return readFileSync(join(projectRoot, path), 'utf8');
}

function registeredCommandNames(): string[] {
  // Command coverage is derived from the production command modules themselves. The existing e2e
  // registration suite proves that each module loads and registers; this scan extracts only the
  // top-level builder name (the first setName call in each file), not subcommands or options.
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  return readdirSync(join(projectRoot, 'src/commands'))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => {
      const match = source(`src/commands/${file}`).match(/\.setName\('([^']+)'\)/);
      expect(match).not.toBeNull();
      return match![1];
    });
}

function literalPrefixes(handlerSource: string): Set<string> {
  const prefixes = new Set<string>();

  for (const match of handlerSource.matchAll(/customId\.startsWith\('([^']+)'\)/g)) {
    prefixes.add(match[1]);
  }
  for (const match of handlerSource.matchAll(/customId === '([^']+)'/g)) {
    prefixes.add(match[1]);
  }

  return prefixes;
}

function buttonRegexPrefixes(handlerSource: string): Set<string> {
  const prefixes = new Set<string>();

  for (const match of handlerSource.matchAll(/\/\^([A-Za-z][A-Za-z0-9_-]*:?)/g)) {
    prefixes.add(match[1]);
  }

  const grouped = handlerSource.match(/\^\(\?:([^)]*)\)/)?.[1];
  if (grouped) {
    for (const alternative of grouped.split('|')) prefixes.add(`${alternative}:`);
  }

  // The help route branches below the common prefix. Both branches are registered explicitly in
  // ComponentPolicy, so retain their actual policy boundaries instead of treating all help IDs as
  // one route.
  if (handlerSource.includes('/^help:(?:role:')) {
    prefixes.delete('help:');
    prefixes.add('help:role:');
    prefixes.add('help:back');
  }

  return prefixes;
}

function hasComponentPolicy(prefix: string): boolean {
  return ComponentPolicy.some(([policyPrefix]) => prefix.startsWith(policyPrefix));
}

function missingComponentPolicies(prefixes: Iterable<string>): string[] {
  return [...prefixes].filter((prefix) => !hasComponentPolicy(prefix)).sort();
}

describe('feature policy registration completeness', () => {
  test('every production command has an explicit feature policy', () => {
    const missing = registeredCommandNames()
      .filter((name) => !Object.prototype.hasOwnProperty.call(CommandPolicy, name))
      .sort();

    expect(missing).toEqual([]);
  });

  test('every registered button, select, and modal route has an explicit feature policy', () => {
    const buttonSource = source('src/handlers/button_handlers/index.ts');
    const registeredPrefixes = new Set([
      ...literalPrefixes(buttonSource),
      ...buttonRegexPrefixes(buttonSource),
      ...literalPrefixes(source('src/handlers/select_menu_handlers/index.ts')),
      ...literalPrefixes(source('src/handlers/modal_handlers/index.ts')),
    ]);
    const missing = missingComponentPolicies(registeredPrefixes);

    expect(missing).toEqual([]);
  });

  test('reports a newly registered component without a policy', () => {
    expect(missingComponentPolicies(['unmappedTestAction:'])).toEqual(['unmappedTestAction:']);
  });
});
