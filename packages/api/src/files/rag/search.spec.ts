import { executeFileSearchQuery } from './search';

it('exposes the retrieved PDF pages to the model and preserves citation page metadata', async () => {
  const [text, artifact] = await executeFileSearchQuery({
    query: 'kode verifikasi',
    userId: 'member',
    files: [{ file_id: 'document' }],
    fileCitations: true,
    ragApiUrl: 'http://rag',
    httpClient: {
      post: jest.fn().mockResolvedValue({
        data: [
          [
            { page_content: 'Awal dokumen', metadata: { source: '/uploads/report.pdf', page: 0 } },
            0.2,
          ],
          [
            {
              page_content: 'Kode verifikasi dan nilai kontrol',
              metadata: { source: '/uploads/report.pdf', page: 2 },
            },
            0.1,
          ],
          [
            {
              page_content: 'Keterangan tanpa nomor halaman',
              metadata: { source: '/uploads/notes.txt' },
            },
            0.3,
          ],
        ],
      }),
    },
    generateShortLivedToken: () => 'fixture-token',
    logAxiosError: jest.fn(),
    selectFileCitationSources: jest.fn((sources) => [...(sources ?? [])]),
    logger: { debug: jest.fn() },
  });
  expect(text).toContain('Page: 3\nRelevance: 0.9000\nContent: Kode verifikasi');
  expect(text).toContain('Page: 1\nRelevance: 0.8000\nContent: Awal dokumen');
  expect(text).not.toContain('Page: 0');
  expect(text).not.toContain('Page: null');
  expect(artifact?.file_search.sources.map((source) => source.pages)).toEqual([[3], [1], []]);
});
