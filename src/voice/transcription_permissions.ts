import {
  ChannelType,
  Guild,
  GuildMember,
  GuildTextBasedChannel,
  PermissionFlagsBits,
  VoiceBasedChannel,
} from 'discord.js';

export type MissingTranscriptionPermissions = {
  channelId: string;
  channelName: string;
  permissions: string[];
};

type PermissionRequirement = {
  bit: bigint;
  label: string;
};

const voiceRequirements: PermissionRequirement[] = [
  { bit: PermissionFlagsBits.ViewChannel, label: 'View Channel' },
  { bit: PermissionFlagsBits.Connect, label: 'Connect' },
];

const baseTextRequirements: PermissionRequirement[] = [
  { bit: PermissionFlagsBits.ViewChannel, label: 'View Channel' },
  { bit: PermissionFlagsBits.ReadMessageHistory, label: 'Read Message History' },
  { bit: PermissionFlagsBits.AttachFiles, label: 'Attach Files' },
];

const sendMessageRequirement: PermissionRequirement = {
  bit: PermissionFlagsBits.SendMessages,
  label: 'Send Messages',
};

const sendThreadMessageRequirement: PermissionRequirement = {
  bit: PermissionFlagsBits.SendMessagesInThreads,
  label: 'Send Messages in Threads',
};

export async function getMissingTranscriptionPermissions(
  guild: Guild,
  voiceChannel: VoiceBasedChannel,
  textChannel: GuildTextBasedChannel,
): Promise<MissingTranscriptionPermissions[]> {
  const botMember = guild.members.me ?? (await guild.members.fetchMe());
  return checkTranscriptionPermissions(botMember, voiceChannel, textChannel);
}

export function checkTranscriptionPermissions(
  botMember: GuildMember,
  voiceChannel: VoiceBasedChannel,
  textChannel: GuildTextBasedChannel,
): MissingTranscriptionPermissions[] {
  const missing = [
    missingForChannel(botMember, voiceChannel, voiceRequirements),
    missingForChannel(botMember, textChannel, textRequirements(textChannel)),
  ].filter((entry): entry is MissingTranscriptionPermissions => Boolean(entry));

  return missing;
}

export function formatMissingTranscriptionPermissions(
  missing: MissingTranscriptionPermissions[],
): string {
  return [
    '⚠️ I can’t start transcription with those channels yet.',
    'I’m missing:',
    ...missing.map(
      (entry) => `- ${entry.channelName} (<#${entry.channelId}>): ${entry.permissions.join(', ')}`,
    ),
  ].join('\n');
}

function missingForChannel(
  botMember: GuildMember,
  channel: VoiceBasedChannel | GuildTextBasedChannel,
  requirements: PermissionRequirement[],
): MissingTranscriptionPermissions | null {
  const permissions = channel.permissionsFor(botMember);
  const missing = requirements
    .filter((requirement) => !permissions?.has(requirement.bit))
    .map((requirement) => requirement.label);

  if (missing.length === 0) return null;

  return {
    channelId: channel.id,
    channelName: channel.name,
    permissions: missing,
  };
}

function textRequirements(channel: GuildTextBasedChannel): PermissionRequirement[] {
  return [
    ...baseTextRequirements,
    isThreadChannel(channel) ? sendThreadMessageRequirement : sendMessageRequirement,
  ];
}

function isThreadChannel(channel: GuildTextBasedChannel): boolean {
  return (
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread
  );
}
