import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

import { ComponentPolicy } from '../../../src/access/components_policy';
import { CommandPolicy } from '../../../src/access/features';

const projectRoot = join(__dirname, '../../..');

function sourceFile(path: string): ts.SourceFile {
  const absolutePath = join(projectRoot, path);
  return ts.createSourceFile(
    absolutePath,
    readFileSync(absolutePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function stringValue(node: ts.Node | undefined): string | null {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null;
}

function registeredCommandNames(): string[] {
  // The first setName call by source position is the command builder's name. Later calls belong to
  // subcommands, choices, and options. The production registration e2e suite separately proves
  // that every command module loads and registers.
  return readdirSync(join(projectRoot, 'src/commands'))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => {
      const calls: Array<{ name: string; position: number }> = [];
      visit(sourceFile(`src/commands/${file}`), (node) => {
        if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
        if (node.expression.name.text !== 'setName') return;
        const name = stringValue(node.arguments[0]);
        if (name) calls.push({ name, position: node.getStart() });
      });
      calls.sort((left, right) => left.position - right.position);
      expect(calls).not.toHaveLength(0);
      return calls[0].name;
    });
}

function literalRoutePrefixes(file: ts.SourceFile): Set<string> {
  const prefixes = new Set<string>();

  visit(file, (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression;
      if (
        ts.isIdentifier(receiver) &&
        receiver.text === 'customId' &&
        node.expression.name.text === 'startsWith'
      ) {
        const prefix = stringValue(node.arguments[0]);
        if (prefix) prefixes.add(prefix);
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)
    ) {
      const leftIsCustomId = ts.isIdentifier(node.left) && node.left.text === 'customId';
      const rightIsCustomId = ts.isIdentifier(node.right) && node.right.text === 'customId';
      const route = leftIsCustomId
        ? stringValue(node.right)
        : rightIsCustomId
          ? stringValue(node.left)
          : null;
      if (route) prefixes.add(route);
    }
  });

  return prefixes;
}

function prefixesFromRouteRegex(pattern: string): string[] {
  const simple = pattern.match(/^\^([A-Za-z][A-Za-z0-9_-]*:?)/)?.[1];
  if (simple === 'help:') return ['help:role:', 'help:back'];
  if (simple) return [simple];

  const alternatives = pattern.match(/^\^\(\?:([A-Za-z0-9_|-]+)\):/)?.[1];
  return alternatives ? alternatives.split('|').map((alternative) => `${alternative}:`) : [];
}

function regexRoutePrefixes(file: ts.SourceFile): Set<string> {
  const prefixes = new Set<string>();
  visit(file, (node) => {
    if (!ts.isRegularExpressionLiteral(node) || !node.text.startsWith('/^')) return;
    const closingSlash = node.text.lastIndexOf('/');
    const pattern = node.text.slice(1, closingSlash);
    for (const prefix of prefixesFromRouteRegex(pattern)) prefixes.add(prefix);
  });
  return prefixes;
}

function registeredComponentPrefixes(): Set<string> {
  const buttonRoutes = sourceFile('src/handlers/button_handlers/index.ts');
  const selectRoutes = sourceFile('src/handlers/select_menu_handlers/index.ts');
  const modalRoutes = sourceFile('src/handlers/modal_handlers/index.ts');

  return new Set([
    ...literalRoutePrefixes(buttonRoutes),
    ...regexRoutePrefixes(buttonRoutes),
    ...literalRoutePrefixes(selectRoutes),
    ...literalRoutePrefixes(modalRoutes),
  ]);
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
    expect(missingComponentPolicies(registeredComponentPrefixes())).toEqual([]);
  });

  test('reports a newly registered component without a policy', () => {
    expect(missingComponentPolicies(['unmappedTestAction:'])).toEqual(['unmappedTestAction:']);
  });
});
