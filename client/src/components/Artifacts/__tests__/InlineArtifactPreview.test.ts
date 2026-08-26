import type { Artifact } from '~/common';
import { TOOL_ARTIFACT_TYPES } from '~/utils/artifacts';
import { logicalInlineArtifactIdentity, supportsInlineArtifact } from '../InlineArtifactPreview';

describe('logicalInlineArtifactIdentity', () => {
  test('shares a claim for a direct artifact and its generated HTML file', () => {
    const directArtifact = {
      identifier: 'dashboard-lanjutan-pt',
      title: 'Dashboard Lanjutan Anomali PT AHU (7 Chart)',
      type: 'text/html',
    } as Artifact;
    const generatedFile = {
      title: 'dashboard_lanjutan_pt.html',
      type: 'text/html',
    } as Artifact;

    expect(logicalInlineArtifactIdentity(directArtifact)).toBe(
      logicalInlineArtifactIdentity(generatedFile),
    );
  });

  test('does not merge unrelated visual deliverables', () => {
    const dashboard = { title: 'Dashboard distribusi PT.html', type: 'text/html' } as Artifact;
    const heatmap = { title: 'Heatmap PNBP.html', type: 'text/html' } as Artifact;

    expect(logicalInlineArtifactIdentity(dashboard)).not.toBe(
      logicalInlineArtifactIdentity(heatmap),
    );
  });

  test.each([
    TOOL_ARTIFACT_TYPES.SVG,
    TOOL_ARTIFACT_TYPES.PLAIN_TEXT,
    TOOL_ARTIFACT_TYPES.MARKDOWN,
    TOOL_ARTIFACT_TYPES.MERMAID,
  ])('supports %s for direct inline rendering', (type) => {
    expect(supportsInlineArtifact({ type, content: 'content' } as Artifact)).toBe(true);
  });

  test('does not treat JSON as an inline visual artifact', () => {
    expect(supportsInlineArtifact({ type: TOOL_ARTIFACT_TYPES.JSON, content: '{"a":1}' } as Artifact)).toBe(false);
  });
});
