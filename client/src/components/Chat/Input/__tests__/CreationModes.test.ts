import { buildCreationModePrompt, MORE_MODES, PRIMARY_MODES } from '../CreationModes';
import { ArtifactModes } from 'librechat-data-provider';

describe('HelloDigi creation mode catalogue', () => {
  const modes = [...PRIMARY_MODES, ...MORE_MODES];

  it('gives every shortcut a complete, distinct set of samples', () => {
    expect(modes).toHaveLength(18);
    expect(new Set(modes.map((mode) => mode.id)).size).toBe(modes.length);

    for (const mode of modes) {
      expect(mode.label.length).toBeGreaterThanOrEqual(2);
      expect(mode.description.length).toBeGreaterThanOrEqual(12);
      expect(mode.examples).toHaveLength(4);
      expect(new Set(mode.examples).size).toBe(mode.examples.length);
      expect(mode.examples.every((example) => example.trim().length >= 8)).toBe(true);
    }
  });

  it('builds a usable prompt for every sample without omitting chat examples', () => {
    for (const mode of modes) {
      for (const example of mode.examples) {
        expect(buildCreationModePrompt(mode, example)).toContain(example);
        expect(buildCreationModePrompt(mode, example).trim().length).toBeGreaterThanOrEqual(example.length);
      }
    }
  });

  it('loads the shadcn/ui contract for an end-to-end application', () => {
    expect(MORE_MODES.find((mode) => mode.id === 'apps')?.artifacts).toBe(ArtifactModes.SHADCNUI);
  });
});
