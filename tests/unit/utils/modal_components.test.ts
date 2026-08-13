import { TextInputBuilder, TextInputStyle } from 'discord.js';
import {
  modalStringSelect,
  modalTextInput,
  modalTextInputBuilder,
  getModalStringSelectValue,
} from '../../../src/utils/modal_components';

describe('modal component builders', () => {
  test('builds a current Label-wrapped text input without the deprecated nested label', () => {
    expect(
      modalTextInput({
        customId: 'field',
        label: 'Field',
        description: 'Helpful copy',
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: 200,
      }).toJSON(),
    ).toEqual({
      type: 18,
      label: 'Field',
      description: 'Helpful copy',
      component: expect.objectContaining({
        type: 4,
        custom_id: 'field',
        style: TextInputStyle.Paragraph,
        required: false,
        max_length: 200,
      }),
    });
  });

  test('migrates a legacy text builder without retaining its nested label', () => {
    const result = modalTextInputBuilder(
      new TextInputBuilder()
        .setCustomId('legacy')
        .setLabel('Legacy label')
        .setStyle(TextInputStyle.Short),
    ).toJSON();

    expect(result.label).toBe('Legacy label');
    expect(result.component).toEqual(expect.objectContaining({ custom_id: 'legacy' }));
    expect(result.component).not.toHaveProperty('label');
  });

  test('builds a bounded Label-wrapped modal select', () => {
    expect(
      modalStringSelect({
        customId: 'choice',
        label: 'Choose one',
        options: [
          { label: 'First', value: 'first', default: true },
          { label: 'Second', value: 'second', description: 'Another choice' },
        ],
      }).toJSON(),
    ).toEqual(
      expect.objectContaining({
        type: 18,
        label: 'Choose one',
        component: expect.objectContaining({
          type: 3,
          custom_id: 'choice',
          options: [
            expect.objectContaining({ label: 'First', value: 'first', default: true }),
            expect.objectContaining({
              label: 'Second',
              value: 'second',
              description: 'Another choice',
            }),
          ],
        }),
      }),
    );
  });

  test('rejects empty, oversized-option, and oversized-custom-id inputs', () => {
    expect(() => modalStringSelect({ customId: 'choice', label: 'Choice', options: [] })).toThrow(
      'between 1 and 25',
    );
    expect(() =>
      modalStringSelect({
        customId: 'choice',
        label: 'Choice',
        options: Array.from({ length: 26 }, (_, index) => ({
          label: `Choice ${index}`,
          value: String(index),
        })),
      }),
    ).toThrow('between 1 and 25');
    expect(() => modalTextInput({ customId: 'x'.repeat(101), label: 'Too long' })).toThrow(
      'Discord custom ID must be between 1 and 100 characters',
    );
  });

  test('reads current selects and already-open legacy text submissions', () => {
    expect(
      getModalStringSelectValue(
        {
          getStringSelectValues: jest.fn().mockReturnValue(['+']),
          getTextInputValue: jest.fn(),
        },
        'operator',
      ),
    ).toBe('+');

    expect(
      getModalStringSelectValue(
        {
          getStringSelectValues: jest.fn().mockImplementation(() => {
            throw new Error('The field is a text input.');
          }),
          getTextInputValue: jest.fn().mockReturnValue('-'),
        },
        'operator',
      ),
    ).toBe('-');
  });
});
