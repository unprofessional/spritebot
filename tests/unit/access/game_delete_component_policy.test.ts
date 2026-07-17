import { ComponentPolicy } from '../../../src/access/components_policy';

function featureFor(customId: string) {
  return ComponentPolicy.find(([prefix]) => customId.startsWith(prefix))?.[1];
}

describe('game deletion component policies', () => {
  test.each(['deleteGame:game-1', 'confirmDeleteGame:game-1', 'restoreGameDropdown'])(
    'gates %s as game administration',
    (customId) => {
      expect(featureFor(customId)).toBe('rpg:game-admin');
    },
  );

  test('keeps game-view cancellation as core navigation', () => {
    expect(featureFor('goBackToGame:game-1')).toBe('core');
  });
});
