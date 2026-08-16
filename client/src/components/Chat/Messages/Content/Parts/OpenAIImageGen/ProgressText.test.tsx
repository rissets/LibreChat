import { render, screen } from '@testing-library/react';
import ProgressText from './ProgressText';
import { getImageGenLiveAnnouncement } from './OpenAIImageGen';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) =>
    ({
      com_ui_image_created: 'Gambar berhasil dibuat.',
      com_ui_image_edited: 'Gambar berhasil diedit.',
      com_ui_creating_image: 'Membuat gambar…',
      com_ui_image_gen_failed: 'Pembuatan gambar gagal',
    })[key] ?? key,
}));

jest.mock('~/utils', () => ({
  cn: (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(' '),
}));

jest.mock('.', () => ({ AGENT_STYLE_TOOLS: new Set(['image_gen_oai']) }));

describe('ProgressText', () => {
  const localize = (key: string) =>
    ({
      com_ui_image_created: 'Gambar berhasil dibuat.',
      com_ui_image_edited: 'Gambar berhasil diedit.',
      com_ui_image_gen_failed: 'Pembuatan gambar gagal',
      com_ui_cancelled: 'Dibatalkan',
    })[key] ?? key;

  it('announces only concise localized confirmation after completion', () => {
    const verboseIntent = 'Call it exactly once with the internal image model';
    const announcement = getImageGenLiveAnnouncement({
      progress: 1,
      cancelled: false,
      hasError: false,
      toolName: 'image_gen_oai',
      localize,
    });

    expect(announcement).toBe('Gambar berhasil dibuat.');
    expect(announcement).not.toContain(verboseIntent);
  });
  it('uses one concise Indonesian completion message and ignores intent', () => {
    render(
      <ProgressText
        progress={1}
        toolName="image_gen_oai"
        intent="Call it exactly once with the internal image model"
      />,
    );

    expect(screen.getByText('Gambar berhasil dibuat.')).toBeVisible();
    expect(screen.queryByText(/Call it exactly once|internal image model/i)).not.toBeInTheDocument();
  });

  it('preserves actionable error text', () => {
    render(<ProgressText progress={1} error toolName="image_gen_oai" />);
    expect(screen.getByText('Pembuatan gambar gagal')).toBeVisible();
  });
});
