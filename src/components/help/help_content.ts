import type { FeatureKey } from '../../access/features';

export type HelpRole = 'player' | 'gm';
export type HelpCategoryId =
  | 'getting-started'
  | 'games'
  | 'game-management'
  | 'characters'
  | 'roleplay'
  | 'inventory'
  | 'dice'
  | 'voice-transcription'
  | 'server-tools'
  | 'subscription';

export interface HelpCommandEntry {
  command: string;
  description: string;
  feature: FeatureKey;
  note?: string;
}

export interface HelpCategory {
  id: HelpCategoryId;
  label: string;
  emoji: string;
  description: string;
  requiredFeature?: FeatureKey;
  commands?: HelpCommandEntry[];
  walkthrough?: (features: ReadonlySet<FeatureKey>) => string;
}

const games: HelpCategory = {
  id: 'games',
  label: 'Games',
  emoji: '🎲',
  description: 'Join and switch campaigns',
  commands: [
    command('/join-game', 'Join a published game.', 'core'),
    command('/view-game', 'See your active game.', 'core'),
    command('/list-games', 'See games in this server.', 'core'),
    command('/switch-game', 'Change your active game.', 'core'),
  ],
};

const characters: HelpCategory = {
  id: 'characters',
  label: 'Characters',
  emoji: '🧙',
  description: 'Create and manage characters',
  commands: [
    command('/create-character', 'Build a new character.', 'rpg:characters'),
    command('/view-character', 'See your active character.', 'core'),
    command('/list-characters', 'Browse public characters.', 'core'),
    command('/switch-character', 'Change your active character.', 'core'),
    command(
      '/restore-character',
      'Recover a recently deleted character.',
      'rpg:characters',
      'Available for 30 days after deletion.',
    ),
  ],
};

const roleplay: HelpCategory = {
  id: 'roleplay',
  label: 'Roleplay',
  emoji: '🎭',
  description: 'Post as your character',
  requiredFeature: 'rpg:characters',
  commands: [
    command('/ic', 'Start posting as your character.', 'rpg:characters'),
    command('/ooc', 'Return to normal messages.', 'rpg:characters'),
    command('/ic-edit', 'Edit one of your proxied posts.', 'rpg:characters'),
    command('/ic-delete', 'Delete one of your proxied posts.', 'rpg:characters'),
    command(
      'Edit IC Message',
      'Edit from the message menu.',
      'rpg:characters',
      'Right-click your proxied post, choose **Apps**, then **Edit IC Message**.',
    ),
    command(
      'Delete IC Message',
      'Delete from the message menu.',
      'rpg:characters',
      'Right-click your proxied post, choose **Apps**, then **Delete IC Message**.',
    ),
  ],
};

const inventory: HelpCategory = {
  id: 'inventory',
  label: 'Inventory',
  emoji: '🎒',
  description: 'Manage character items',
  requiredFeature: 'rpg:inventory',
  commands: [command('/inventory', 'Manage your active character’s items.', 'rpg:inventory')],
};

const dice: HelpCategory = {
  id: 'dice',
  label: 'Dice',
  emoji: '🎯',
  description: 'Roll dice at the table',
  commands: [
    command('/roll', 'Roll standard dice notation.', 'core', 'Example: `/roll dice:2d20`.'),
  ],
};

const voiceTranscription: HelpCategory = {
  id: 'voice-transcription',
  label: 'Voice Transcription',
  emoji: '🎤',
  description: 'Record session transcripts',
  requiredFeature: 'pro:transcription',
  commands: [
    command(
      '/transcribe',
      'Start, stop, or check transcription.',
      'pro:transcription',
      'Only GMs can manage transcription sessions.',
    ),
  ],
};

const subscription: HelpCategory = {
  id: 'subscription',
  label: 'Subscription & Support',
  emoji: '⭐',
  description: 'Manage access or get help',
  commands: [
    command('/subscribe', 'View this server’s subscription.', 'core'),
    command('/support', 'Join the support server.', 'core'),
  ],
};

const playerGettingStarted: HelpCategory = {
  id: 'getting-started',
  label: 'Getting Started',
  emoji: '🚀',
  description: 'Join, create, and play',
  requiredFeature: 'core',
  walkthrough: (features) => {
    const steps = [
      '1️⃣ **Join a game** — Use `/join-game` to pick a published game in this server.',
    ];
    if (features.has('rpg:characters')) {
      steps.push(
        '2️⃣ **Create a character** — Use `/create-character`, fill in the requested fields, and save your character.',
        '3️⃣ **Play** — Use `/ic` in a roleplay channel to post as your character, then `/ooc` to switch back.',
      );
      return `${steps.join('\n')}\n\nThat’s it! Your GM handles game setup—you just need to join and create a character.`;
    }
    steps.push(
      '2️⃣ **Explore the table** — Use `/view-game`, `/list-characters`, and `/roll` while your GM manages character access.',
    );
    return `${steps.join('\n')}\n\nYour server’s current access includes the core play tools shown in this help menu.`;
  },
};

const gmGettingStarted: HelpCategory = {
  id: 'getting-started',
  label: 'Getting Started',
  emoji: '🚀',
  description: 'Create and publish a game',
  requiredFeature: 'rpg:game-admin',
  walkthrough: () =>
    [
      '1️⃣ **Create a game** — Use `/create-game` to name your campaign and make it active.',
      '2️⃣ **Define character fields** — Add the stats and details players need from the game setup card.',
      '3️⃣ **Publish it** — Toggle the game to public when players should be able to join.',
      '4️⃣ **Manage the table** — Use `/view-game` for game controls and `/admin` for server audits.',
      '',
      'Players can now use `/join-game` and build their characters.',
    ].join('\n'),
};

const gameManagement: HelpCategory = {
  id: 'game-management',
  label: 'Game Management',
  emoji: '🎲',
  description: 'Create and manage campaigns',
  commands: [
    command('/create-game', 'Create a new campaign.', 'rpg:game-admin'),
    command('/view-game', 'View and manage your active game.', 'core'),
    command('/list-games', 'See games in this server.', 'core'),
    command('/switch-game', 'Change your active game.', 'core'),
    command(
      '/restore-game',
      'Recover a recently deleted game.',
      'rpg:game-admin',
      'Available for 30 days after deletion.',
    ),
  ],
};

const serverTools: HelpCategory = {
  id: 'server-tools',
  label: 'Server Tools',
  emoji: '⚙️',
  description: 'Announcements, threads, and audits',
  commands: [
    command('/bot-announcements', 'Choose lifecycle announcement channels.', 'rpg:game-admin'),
    command('/bump-thread', 'Keep selected threads active.', 'automation:thread-bump'),
    command('/admin', 'Run GM and server audits.', 'rpg:game-admin'),
  ],
};

const HELP_BY_ROLE: Record<HelpRole, HelpCategory[]> = {
  player: [
    playerGettingStarted,
    games,
    characters,
    roleplay,
    inventory,
    dice,
    voiceTranscription,
    subscription,
  ],
  gm: [
    gmGettingStarted,
    gameManagement,
    characters,
    roleplay,
    inventory,
    dice,
    voiceTranscription,
    serverTools,
    subscription,
  ],
};

function command(
  commandName: string,
  description: string,
  feature: FeatureKey,
  note?: string,
): HelpCommandEntry {
  return { command: commandName, description, feature, note };
}

export function getVisibleHelpCategories(
  role: HelpRole,
  features: ReadonlySet<FeatureKey>,
): HelpCategory[] {
  return HELP_BY_ROLE[role]
    .filter((category) => !category.requiredFeature || features.has(category.requiredFeature))
    .map((category) => ({
      ...category,
      commands: category.commands?.filter((entry) => features.has(entry.feature)),
    }))
    .filter((category) => category.walkthrough || (category.commands?.length ?? 0) > 0);
}

export function getVisibleHelpCategory(
  role: HelpRole,
  categoryId: string,
  features: ReadonlySet<FeatureKey>,
): HelpCategory | null {
  return (
    getVisibleHelpCategories(role, features).find((category) => category.id === categoryId) ?? null
  );
}

export function isHelpRole(value: string): value is HelpRole {
  return value === 'player' || value === 'gm';
}
