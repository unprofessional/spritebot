import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ESLint, type Linter } from 'eslint';
import parserTs = require('@typescript-eslint/parser');

const discordBoundaryRule =
  require('../../../eslint-rules/discord-boundary.cjs') as Linter.RuleModule;

describe('discord-boundary ESLint rule', () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = fs.mkdtempSync(path.join(process.cwd(), '.discord-boundary-fixture-'));
    fs.mkdirSync(path.join(fixtureRoot, 'src', 'discord'), { recursive: true });
    fs.writeFileSync(
      path.join(fixtureRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'node16',
          moduleResolution: 'node16',
          strict: true,
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  test('classifies Discord interactions, REST, raw HTTP, and SDK operations by provenance', async () => {
    fs.writeFileSync(
      path.join(fixtureRoot, 'src', 'violations.ts'),
      `
        import {
          ChatInputCommandInteraction,
          Client,
          GuildMember,
          Message,
          REST,
          Routes,
          TextChannel,
          ThreadChannel,
          WebhookClient,
        } from 'discord.js';

        async function exercise(
          interaction: ChatInputCommandInteraction,
          client: Client,
          channel: TextChannel,
          member: GuildMember,
          message: Message,
          webhook: WebhookClient,
          thread: ThreadChannel,
        ) {
          await interaction.reply({ content: 'reply' });
          await interaction.deferReply();
          await interaction.editReply({ content: 'edit' });
          await interaction.followUp({ content: 'follow-up' });
          await interaction.showModal({} as never);
          await interaction.update({ content: 'update' });
          await interaction.deferUpdate();

          const discordApi = 'https://discord.com/api/v10';
          const gatewayUrl = new URL(\`\${discordApi}/gateway\`);
          await fetch(gatewayUrl.toString());
          const rest = new REST({ version: '10' });
          await rest.put(Routes.applicationCommands('app-id'), { body: [] });

          await client.channels.fetch('channel-id');
          await client.login('token');
          await channel.messages.fetch('message-id');
          await member.guild.members.fetch('member-id');
          await channel.send({ content: 'send' });
          await message.edit({ content: 'edit' });
          await message.delete();
          await webhook.send({ content: 'webhook' });
          await thread.setArchived(false);

          const domain = {
            fetch: async () => undefined,
            send: async () => undefined,
            edit: async () => undefined,
            delete: async () => undefined,
          };
          await domain.fetch();
          await domain.send();
          await domain.edit();
          await domain.delete();
        }

        void exercise;
      `,
    );
    fs.writeFileSync(
      path.join(fixtureRoot, 'src', 'discord', 'allowed.ts'),
      `
        import type { ChatInputCommandInteraction } from 'discord.js';
        export async function allowed(interaction: ChatInputCommandInteraction) {
          await interaction.reply({ content: 'allowed' });
        }
      `,
    );

    const results = await lintFixture(fixtureRoot);
    const findings = results.flatMap((result) =>
      result.messages
        .filter((message) => message.ruleId === 'local/discord-boundary')
        .map((message) => ({ filePath: result.filePath, message: message.message })),
    );
    const messages = findings.map((finding) => finding.message);

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('family=interaction method=reply status=unmigrated'),
        expect.stringContaining('family=interaction method=deferReply status=unmigrated'),
        expect.stringContaining('family=interaction method=editReply status=unmigrated'),
        expect.stringContaining('family=interaction method=followUp status=unmigrated'),
        expect.stringContaining('family=interaction method=showModal status=unmigrated'),
        expect.stringContaining('family=interaction method=update status=unmigrated'),
        expect.stringContaining('family=interaction method=deferUpdate status=unmigrated'),
        expect.stringContaining('family=raw-http method=fetch status=unmigrated'),
        expect.stringContaining('family=rest method=constructor status=unmigrated'),
        expect.stringContaining('family=rest method=applicationCommands status=unmigrated'),
        expect.stringContaining('family=rest method=put status=unmigrated'),
        expect.stringContaining('family=sdk-read method=fetch status=unmigrated'),
        expect.stringContaining('family=sdk-write method=login status=unmigrated'),
        expect.stringContaining('family=sdk-write method=send status=unmigrated'),
        expect.stringContaining('family=sdk-write method=edit status=unmigrated'),
        expect.stringContaining('family=sdk-write method=delete status=unmigrated'),
        expect.stringContaining('family=sdk-write method=setArchived status=unmigrated'),
      ]),
    );
    expect(findings).toHaveLength(20);
    expect(findings.some((finding) => finding.filePath.endsWith('allowed.ts'))).toBe(false);
  });
});

async function lintFixture(fixtureRoot: string): Promise<ESLint.LintResult[]> {
  const eslint = new ESLint({
    cwd: fixtureRoot,
    globInputPaths: false,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser: parserTs,
          parserOptions: {
            project: './tsconfig.json',
            tsconfigRootDir: fixtureRoot,
            sourceType: 'module',
            ecmaVersion: 'latest',
          },
        },
        plugins: {
          local: {
            rules: {
              'discord-boundary': discordBoundaryRule,
            },
          },
        },
        rules: {
          'local/discord-boundary': [
            'warn',
            {
              allowlist: ['src/discord/**'],
            },
          ],
        },
      },
    ],
  });

  return eslint.lintFiles(['src/violations.ts', 'src/discord/allowed.ts']);
}
