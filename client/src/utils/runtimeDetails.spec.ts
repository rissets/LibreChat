import { redactInternalRuntimeDetails } from './runtimeDetails';

describe('redactInternalRuntimeDetails', () => {
  it('replaces sandbox paths without changing surrounding user-facing text', () => {
    expect(
      redactInternalRuntimeDetails(
        'Catatan teknis: file /mnt/data/kapal_pelanggar_zona.html telah diperbarui.',
      ),
    ).toBe('Catatan teknis: file file hasil telah diperbarui.');
  });

  it('also redacts session-prefixed runtime locations', () => {
    expect(redactInternalRuntimeDetails('sandbox:/tmp/code/chart.svg siap.')).toBe(
      'file hasil siap.',
    );
  });

  it('preserves regular text', () => {
    expect(redactInternalRuntimeDetails('Presentasi siap untuk ditinjau.')).toBe(
      'Presentasi siap untuk ditinjau.',
    );
  });
});
