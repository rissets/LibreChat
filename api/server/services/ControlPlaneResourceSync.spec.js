const { extractArtifactInventory } = require('./ControlPlaneResourceSync');

describe('ControlPlaneResourceSync', () => {
  it('extracts artifact inventory metadata without retaining content', () => {
    const message = {
      text: `Before
:::artifact{identifier="public-service" type="text/html" title="Portal Layanan"}
\`\`\`\`html
<main>private generated content</main>
\`\`\`\`
:::
After`,
    };

    expect(extractArtifactInventory(message)).toEqual([
      {
        identifier: 'public-service',
        title: 'Portal Layanan',
        type: 'text/html',
      },
    ]);
    expect(JSON.stringify(extractArtifactInventory(message))).not.toContain('private generated');
  });

  it('reads artifacts from structured text parts and supports id aliases', () => {
    expect(
      extractArtifactInventory({
        content: [
          {
            type: 'text',
            text: ":::artifact{id='flow-1' type='application/vnd.mermaid' title='Alur'}",
          },
        ],
      }),
    ).toEqual([
      { identifier: 'flow-1', title: 'Alur', type: 'application/vnd.mermaid' },
    ]);
  });
});
