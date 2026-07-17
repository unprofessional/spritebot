import type { APIActionRowComponent, APIMessageActionRowComponent } from 'discord.js';

import { build as buildCategoryCard } from '../../../src/components/help/help_category_card';
import { build as buildCategoryMenu } from '../../../src/components/help/help_category_menu';
import { getVisibleHelpCategories } from '../../../src/components/help/help_content';
import { build as buildLandingCard } from '../../../src/components/help/help_landing_card';
import type { FeatureKey } from '../../../src/access/features';

const core = new Set<FeatureKey>(['core']);
const subscribed = new Set<FeatureKey>([
  'core',
  'rpg:characters',
  'rpg:inventory',
  'rpg:game-admin',
  'automation:thread-bump',
]);

describe('help components', () => {
  test('landing card asks for a role and exposes stable button IDs', () => {
    const card = buildLandingCard();

    expect(card).not.toHaveProperty('ephemeral');
    expect(card.embeds[0].toJSON().title).toBe('🎮 Welcome to SPRITE');
    expect(JSON.stringify(card.components.map((row) => row.toJSON()))).toContain(
      'help:role:player',
    );
    expect(JSON.stringify(card.components.map((row) => row.toJSON()))).toContain('help:role:gm');
  });

  test('core-only player help hides premium categories and commands', () => {
    const categories = getVisibleHelpCategories('player', core);

    expect(categories.map((category) => category.id)).toEqual([
      'getting-started',
      'games',
      'characters',
      'dice',
      'subscription',
    ]);
    expect(categories.find((category) => category.id === 'characters')?.commands).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ command: '/create-character' })]),
    );
  });

  test('subscribed GM help shows granted management tools but not transcription', () => {
    const categories = getVisibleHelpCategories('gm', subscribed);

    expect(categories.map((category) => category.id)).toContain('game-management');
    expect(categories.map((category) => category.id)).toContain('server-tools');
    expect(categories.map((category) => category.id)).not.toContain('voice-transcription');
    expect(
      categories
        .find((category) => category.id === 'server-tools')
        ?.commands?.map((entry) => entry.command),
    ).toEqual(['/bot-announcements', '/bump-thread', '/admin']);
  });

  test('transcription appears only when its feature is granted', () => {
    const features = new Set<FeatureKey>([...subscribed, 'pro:transcription']);

    expect(getVisibleHelpCategories('player', features).map((category) => category.id)).toContain(
      'voice-transcription',
    );
  });

  test('category menu keeps back navigation and only includes visible topics', () => {
    const card = buildCategoryMenu('player', core);
    const rows = card.components.map((row) =>
      row.toJSON(),
    ) as APIActionRowComponent<APIMessageActionRowComponent>[];
    const json = JSON.stringify(rows);

    expect(json).toContain('help:category:player');
    expect(json).toContain('help:back');
    expect(json).not.toContain('Voice Transcription');
  });

  test('category detail explains context-menu actions and retains navigation', () => {
    const card = buildCategoryCard('player', 'roleplay', subscribed);

    expect(card?.embeds[0].toJSON().description).toContain('Right-click your proxied post');
    expect(JSON.stringify(card?.components.map((row) => row.toJSON()))).toContain(
      'help:category:player',
    );
  });

  test('does not render a category the guild cannot use', () => {
    expect(buildCategoryCard('player', 'inventory', core)).toBeNull();
  });
});
