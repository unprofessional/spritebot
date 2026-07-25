import { ESLint, type Linter } from 'eslint';
import parserTs = require('@typescript-eslint/parser');

const customIdLengthRule =
  require('../../../eslint-rules/discord-custom-id-length.cjs') as Linter.RuleModule;

async function lint(source: string) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser: parserTs,
          parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        },
        plugins: {
          local: {
            rules: { 'discord-custom-id-length': customIdLengthRule },
          },
        },
        rules: {
          'local/discord-custom-id-length': 'error',
        },
      },
    ],
  });
  return eslint.lintText(source, { filePath: 'custom-id.ts' });
}

describe('discord-custom-id-length ESLint rule', () => {
  test('rejects a custom ID whose UUID fields and suffix exceed Discord limits', async () => {
    const [result] = await lint(`
      declare const builder: { setCustomId(value: string): void };
      declare const entityId: string;
      declare const item: { id: string; equipped: boolean };
      declare function discordCustomId(value: string): string;
      builder.setCustomId(discordCustomId(
        \`equipGameEntityInventory:\${entityId}:\${item.id}:\${item.equipped ? 'off' : 'on'}\`,
      ));
    `);

    expect(result.messages).toEqual([
      expect.objectContaining({
        ruleId: 'local/discord-custom-id-length',
        message: expect.stringContaining('can be 102 characters'),
      }),
    ]);
  });

  test('allows a compact custom ID at or below Discord limits', async () => {
    const [result] = await lint(`
      declare const builder: { setCustomId(value: string): void };
      declare const entityId: string;
      declare const item: { id: string; equipped: boolean };
      declare function discordCustomId(value: string): string;
      builder.setCustomId(discordCustomId(
        \`geInvEquip:\${entityId}:\${item.id}:\${item.equipped ? 'off' : 'on'}\`,
      ));
    `);

    expect(result.messages).toEqual([]);
  });

  test('rejects custom IDs that bypass the shared runtime guard', async () => {
    const [result] = await lint(`
      declare const builder: { setCustomId(value: string): void };
      builder.setCustomId('static-id');
    `);

    expect(result.messages).toEqual([
      expect.objectContaining({
        ruleId: 'local/discord-custom-id-length',
        message: expect.stringContaining('through discordCustomId()'),
      }),
    ]);
  });

  test('also rejects raw component custom_id properties that bypass the guard', async () => {
    const [result] = await lint(`
      declare const gameId: string;
      const component = { custom_id: \`finishStatSetup:\${gameId}\` };
      void component;
    `);

    expect(result.messages).toEqual([
      expect.objectContaining({
        ruleId: 'local/discord-custom-id-length',
        message: expect.stringContaining('through discordCustomId()'),
      }),
    ]);
  });
});
