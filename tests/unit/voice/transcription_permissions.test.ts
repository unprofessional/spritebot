import { ChannelType, GuildMember, PermissionFlagsBits, PermissionsBitField } from 'discord.js';

import {
  checkTranscriptionPermissions,
  formatMissingTranscriptionPermissions,
} from '../../../src/voice/transcription_permissions';

describe('transcription_permissions', () => {
  test('reports missing voice and text output permissions', () => {
    const missing = checkTranscriptionPermissions(
      {} as GuildMember,
      channel('voice-1', 'Table Voice', ChannelType.GuildVoice, [PermissionFlagsBits.ViewChannel]),
      channel('text-1', 'transcripts', ChannelType.GuildText, [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessages,
      ]),
    );

    expect(missing).toEqual([
      {
        channelId: 'voice-1',
        channelName: 'Table Voice',
        permissions: ['Connect'],
      },
      {
        channelId: 'text-1',
        channelName: 'transcripts',
        permissions: ['Attach Files'],
      },
    ]);
    expect(formatMissingTranscriptionPermissions(missing)).toBe(
      [
        '⚠️ I can’t start transcription with those channels yet.',
        'I’m missing:',
        '- Table Voice (<#voice-1>): Connect',
        '- transcripts (<#text-1>): Attach Files',
      ].join('\n'),
    );
  });

  test('uses thread-specific send permissions for thread output channels', () => {
    const missing = checkTranscriptionPermissions(
      {} as GuildMember,
      channel('voice-1', 'Table Voice', ChannelType.GuildVoice, [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
      ]),
      channel('thread-1', 'transcript-thread', ChannelType.PublicThread, [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.SendMessages,
      ]),
    );

    expect(missing).toEqual([
      {
        channelId: 'thread-1',
        channelName: 'transcript-thread',
        permissions: ['Send Messages in Threads'],
      },
    ]);
  });
});

function channel(
  id: string,
  name: string,
  type: ChannelType,
  permissionBits: bigint[],
): {
  id: string;
  name: string;
  type: ChannelType;
  permissionsFor: () => PermissionsBitField;
} {
  return {
    id,
    name,
    type,
    permissionsFor: () => new PermissionsBitField(permissionBits),
  };
}
