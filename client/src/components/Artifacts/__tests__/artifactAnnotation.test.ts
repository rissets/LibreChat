import { buildArtifactAnnotationPrompt } from '../artifactAnnotation';

describe('buildArtifactAnnotationPrompt', () => {
  it('creates an editable draft instruction with element context', () => {
    expect(
      buildArtifactAnnotationPrompt(
        {
          id: 'hero',
          title: 'Portal Operasi',
          content: '',
          type: 'text/html',
          lastUpdateTime: 1724630400000,
        },
        { tag: 'button', text: 'Kirim laporan' },
      ),
    ).toBe(
      'Perbarui artifact “Portal Operasi” pada elemen button yang berisi “Kirim laporan”. Pertahankan bagian lain. Perubahan yang saya inginkan: ',
    );
  });

  it('does not require a selected element for whole-artifact edits', () => {
    expect(
      buildArtifactAnnotationPrompt({
        id: 'report',
        title: 'Laporan KPI',
        content: '',
        type: 'text/html',
        lastUpdateTime: 1724630400000,
      }),
    ).toContain('Perbarui artifact “Laporan KPI”');
  });
});
