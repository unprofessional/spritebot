import { appendNudge, buildNudge, type NudgeContext } from '../../../src/utils/onboarding_nudge';

const baseContext: NudgeContext = {
  userId: 'user-1',
  guildId: 'guild-1',
};

describe('onboarding_nudge', () => {
  test('nudges GMs to define stats after creating a game', () => {
    expect(buildNudge({ ...baseContext, isGM: true }, 'create-game')).toBe(
      "💡 Next: define your game's stat fields with the **➕ Add Another Stat** button, then publish when ready.",
    );
  });

  test('nudges GMs to publish when setup is complete but private', () => {
    expect(
      buildNudge(
        {
          ...baseContext,
          isGM: true,
          hasStatTemplates: true,
          gameIsPublished: false,
        },
        'finish-stat-setup',
      ),
    ).toBe(
      "💡 Stats look good! When you're ready for players, hit **📣 Toggle Visibility** to publish.",
    );
  });

  test('describes both publish states after toggling visibility', () => {
    expect(buildNudge({ ...baseContext, gameIsPublished: true }, 'toggle-publish')).toBe(
      '💡 Your game is live! Players can now use `/join-game` to join and `/create-character` to get started.',
    );
    expect(buildNudge({ ...baseContext, gameIsPublished: false }, 'toggle-publish')).toBe(
      '💡 Game is now private. No new players can join until you publish again.',
    );
  });

  test('nudges empty and populated game lists differently', () => {
    expect(buildNudge(baseContext, 'list-games-empty')).toBe(
      '💡 No games yet! A GM can start one with `/create-game`.',
    );
    expect(buildNudge(baseContext, 'list-games')).toBe(
      '💡 Want to join? Use `/join-game` to pick a game.',
    );
  });

  test('nudges joined players based on whether they already have characters', () => {
    expect(buildNudge({ ...baseContext, hasCharacters: false }, 'join-game')).toBe(
      "💡 You're in! Now create your character with `/create-character`.",
    );
    expect(buildNudge({ ...baseContext, hasCharacters: true }, 'join-game')).toBe(
      '💡 Joined! Use `/create-character` to make a new character for this game, or `/switch-character` if you already have one.',
    );
  });

  test('nudges character and IC mode transitions', () => {
    expect(buildNudge(baseContext, 'submit-character')).toBe(
      '💡 Character ready! Use `/ic` in an RP channel to start posting in-character.',
    );
    expect(buildNudge(baseContext, 'switch-character')).toBe(
      '💡 Now playing as your selected character. Use `/ic` to enter in-character mode in any channel.',
    );
    expect(buildNudge(baseContext, 'ic')).toBe(
      "💡 You're in-character! Your messages in this channel will now proxy through your active character. Use `/ooc` to switch back.",
    );
  });

  test('nudges switched games based on active character state', () => {
    expect(buildNudge({ ...baseContext, hasActiveCharacter: true }, 'switch-game')).toBe(
      '💡 Active game switched. Use `/ic` to start posting as your active character.',
    );
    expect(buildNudge({ ...baseContext, hasActiveCharacter: false }, 'switch-game')).toBe(
      '💡 Active game switched. Use `/create-character` to make a character for this game.',
    );
  });

  test('returns null when no trigger branch applies', () => {
    expect(buildNudge(baseContext, 'unknown-trigger')).toBeNull();
    expect(buildNudge({ ...baseContext, gameId: 'game-1' }, 'list-games')).toBeNull();
  });

  test('keeps append formatting consistent', () => {
    expect(appendNudge('✅ Done.', '💡 Next thing.')).toBe('✅ Done.\n\n💡 Next thing.');
    expect(appendNudge('✅ Done.', null)).toBe('✅ Done.');
  });
});
