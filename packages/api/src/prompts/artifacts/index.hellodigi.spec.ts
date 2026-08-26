import { ArtifactModes, EModelEndpoint } from 'librechat-data-provider';
import { generateArtifactsPrompt } from './index';

describe('HelloDigi artifact mode contracts', () => {
  it('requires a complete multi-file React application in website mode', () => {
    const prompt = generateArtifactsPrompt({
      endpoint: EModelEndpoint.openAI,
      artifacts: ArtifactModes.WEB,
    });

    expect(prompt).toContain('application/vnd.react');
    expect(prompt).toContain('multi-file project tree');
    expect(prompt).toContain('one canonical runnable preview');
  });

  it('makes the shadcn/ui option a concrete build contract', () => {
    const prompt = generateArtifactsPrompt({
      endpoint: EModelEndpoint.openAI,
      artifacts: ArtifactModes.SHADCNUI,
    });

    expect(prompt).toContain('shadcn/ui delivery contract');
    expect(prompt).toContain('verify the artifact compiles');
  });
});
