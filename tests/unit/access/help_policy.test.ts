import { ComponentPolicy } from '../../../src/access/components_policy';
import { CommandPolicy } from '../../../src/access/features';

function featureFor(customId: string) {
  return ComponentPolicy.find(([prefix]) => customId.startsWith(prefix))?.[1];
}

describe('help policies', () => {
  test('gates the help command as core', () => {
    expect(CommandPolicy.help).toBe('core');
  });

  test.each(['help:role:player', 'help:role:gm', 'help:category:player', 'help:back'])(
    'gates %s as core navigation',
    (customId) => {
      expect(featureFor(customId)).toBe('core');
    },
  );
});
