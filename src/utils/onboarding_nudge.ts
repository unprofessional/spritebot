export interface NudgeContext {
  userId: string;
  guildId: string;
  gameId?: string;
  isGM?: boolean;
  gameIsPublished?: boolean;
  hasStatTemplates?: boolean;
  hasCharacters?: boolean;
  hasActiveCharacter?: boolean;
  isInIC?: boolean;
}

export type NudgeTrigger =
  | 'create-game'
  | 'define-stat'
  | 'finish-stat-setup'
  | 'toggle-publish'
  | 'list-games-empty'
  | 'list-games'
  | 'join-game-empty'
  | 'join-game'
  | 'submit-character'
  | 'switch-character'
  | 'switch-game'
  | 'ic'
  | 'ooc'
  | 'create-character-no-game'
  | 'view-character-none'
  | 'list-characters-empty'
  | 'view-game';

export function buildNudge(context: NudgeContext, trigger: NudgeTrigger | string): string | null {
  switch (trigger) {
    case 'create-game':
      if (!context.hasStatTemplates) {
        return "💡 Next: define your game's stat fields with the **➕ Add Another Stat** button, then publish when ready.";
      }
      if (!context.gameIsPublished) {
        return '💡 Your stats are set up! Hit **📣 Toggle Visibility** to publish so players can join.';
      }
      return '💡 Your game is live! Players can use `/join-game` to join and `/create-character` to get started.';

    case 'define-stat':
      return "💡 Add more stats or hit **↩️ Cancel / Go Back** when you're done to return to the game overview.";

    case 'finish-stat-setup':
      if (!context.gameIsPublished) {
        return "💡 Stats look good! When you're ready for players, hit **📣 Toggle Visibility** to publish.";
      }
      return '💡 Your game is live! Players can use `/join-game` to join and `/create-character` to get started.';

    case 'toggle-publish':
      if (context.gameIsPublished) {
        return '💡 Your game is live! Players can now use `/join-game` to join and `/create-character` to get started.';
      }
      return '💡 Game is now private. No new players can join until you publish again.';

    case 'list-games-empty':
      return '💡 No games yet! A GM can start one with `/create-game`.';

    case 'list-games':
      if (!context.gameId) {
        return '💡 Want to join? Use `/join-game` to pick a game.';
      }
      if (context.isGM && !context.hasStatTemplates) {
        return "💡 Next: define your game's stat fields with **➕ Add Another Stat** in `/view-game`.";
      }
      return null;

    case 'join-game-empty':
      return "💡 If you're the GM, your game might need to be published first. Use `/view-game` to check.";

    case 'join-game':
      if (context.hasCharacters) {
        return '💡 Joined! Use `/create-character` to make a new character for this game, or `/switch-character` if you already have one.';
      }
      return "💡 You're in! Now create your character with `/create-character`.";

    case 'submit-character':
      if (!context.isInIC) {
        return '💡 Character ready! Use `/ic` in an RP channel to start posting in-character.';
      }
      return null;

    case 'switch-character':
      return '💡 Now playing as your selected character. Use `/ic` to enter in-character mode in any channel.';

    case 'switch-game':
      if (context.hasActiveCharacter) {
        return '💡 Active game switched. Use `/ic` to start posting as your active character.';
      }
      return '💡 Active game switched. Use `/create-character` to make a character for this game.';

    case 'ic':
      return "💡 You're in-character! Your messages in this channel will now proxy through your active character. Use `/ooc` to switch back.";

    case 'ooc':
      return '💡 Back out-of-character. Use `/ic` when you want to proxy messages through your active character again.';

    case 'create-character-no-game':
      return '💡 You need to join a game first. Use `/join-game` to pick one.';

    case 'view-character-none':
    case 'list-characters-empty':
      return "💡 You don't have a character yet. Use `/create-character` to make one.";

    case 'view-game':
      if (context.isGM && !context.hasStatTemplates) {
        return "💡 Next: define your game's stat fields with **➕ Add Another Stat**.";
      }
      if (context.isGM && !context.gameIsPublished) {
        return '💡 Stats look good! Hit **📣 Toggle Visibility** to publish so players can join.';
      }
      return null;

    default:
      return null;
  }
}

export function appendNudge(content: string, nudge: string | null): string {
  if (!nudge) return content;
  return [content.trimEnd(), '', nudge].join('\n');
}
