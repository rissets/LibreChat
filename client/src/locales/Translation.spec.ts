import type { TranslationResource } from './i18n';
import {
  __resetLocaleForTests,
  __setLocaleLoaderForTests,
  changeLanguageSafely,
  ensureLocale,
  initializeI18n,
  normalizeLocale,
  supportedLocales,
} from './i18n';
import English from './en/translation.json';
import Indonesian from './id/translation.json';
import { TranslationKeys } from '~/hooks';
import i18n from './i18n';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('BP Batam interface languages', () => {
  beforeAll(async () => {
    await initializeI18n();
  });
  afterEach(async () => {
    await changeLanguageSafely('en');
  });
  it('exposes Indonesia and English only', () => {
    expect(supportedLocales).toEqual(['en', 'id']);
  });
  it.each(['en', 'id'])('loads the correct %s resource', async (locale) => {
    await changeLanguageSafely(locale);
    expect(i18n.t('com_ui_examples')).toBe(
      (locale === 'id' ? Indonesian : English).com_ui_examples,
    );
  });
  it.each(['fr-FR', 'de-DE', 'zh-Hans', 'ar-EG', 'pt-BR', 'invalid-code'])(
    'falls back safely for %s',
    async (locale) => {
      expect(normalizeLocale(locale)).toBe('en');
      await changeLanguageSafely(locale);
      expect(i18n.t('com_ui_examples')).toBe(English.com_ui_examples);
      expect(document.documentElement.dir).toBe('ltr');
    },
  );
  it('normalizes supported region and legacy codes', () => {
    expect(normalizeLocale('id-ID')).toBe('id');
    expect(normalizeLocale('in_ID')).toBe('id');
    expect(normalizeLocale('en-GB')).toBe('en');
  });
  it('preserves placeholder formatting and missing keys', async () => {
    await changeLanguageSafely('en');
    expect(i18n.t('com_endpoint_default_with_num', { 0: 'John' })).toBe('default: John');
    expect(i18n.t('invalid-key' as TranslationKeys)).toBe('invalid-key');
  });
  it('deduplicates in-flight resource loads', async () => {
    __resetLocaleForTests('id');
    const pending = deferred<{ default: TranslationResource }>();
    const loader = jest.fn(() => pending.promise);
    const restore = __setLocaleLoaderForTests('id', loader);
    const first = ensureLocale('id-ID'),
      second = ensureLocale('id');
    expect(loader).toHaveBeenCalledTimes(1);
    pending.resolve({ default: Indonesian });
    await expect(Promise.all([first, second])).resolves.toEqual(['id', 'id']);
    restore();
    __resetLocaleForTests('id');
  });
  it('retries a transient failed Indonesian chunk', async () => {
    __resetLocaleForTests('id');
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let calls = 0;
    const restore = __setLocaleLoaderForTests('id', async () => {
      if (++calls === 1) throw new Error('temporary chunk failure');
      return { default: Indonesian };
    });
    await expect(ensureLocale('id')).resolves.toBe('en');
    await expect(ensureLocale('id')).resolves.toBe('id');
    expect(calls).toBe(2);
    restore();
    __resetLocaleForTests('id');
    quiet.mockRestore();
  });
  it('keeps the latest English choice when an older Indonesian load finishes', async () => {
    __resetLocaleForTests('id');
    const pending = deferred<{ default: TranslationResource }>();
    const restore = __setLocaleLoaderForTests('id', () => pending.promise);
    const older = changeLanguageSafely('id');
    await changeLanguageSafely('en');
    pending.resolve({ default: Indonesian });
    await older;
    expect(i18n.language).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    restore();
    __resetLocaleForTests('id');
  });
  it('retains the latest Indonesian choice across rapid switching', async () => {
    __resetLocaleForTests('id');
    const pending = deferred<{ default: TranslationResource }>();
    const restore = __setLocaleLoaderForTests('id', () => pending.promise);
    const first = changeLanguageSafely('id'),
      middle = changeLanguageSafely('en'),
      last = changeLanguageSafely('id');
    pending.resolve({ default: Indonesian });
    await Promise.all([first, middle, last]);
    expect(i18n.language).toBe('id');
    expect(document.documentElement.lang).toBe('id');
    restore();
    __resetLocaleForTests('id');
  });
});

/**
 * Locize groups keys by their plural suffix and generates every form the target
 * language needs. A family without both English `_one` and `_other`, or with a
 * bare base key beside them, leaves translators blank-source rows.
 */
describe('English plural key families', () => {
  const keys = new Set(Object.keys(English));
  const pluralSuffix = /_(zero|one|two|few|many|other)$/;
  const bases = [...keys].flatMap((key) => {
    const match = key.match(pluralSuffix);
    return match ? [key.slice(0, -match[0].length)] : [];
  });

  it.each([...new Set(bases)])('%s has _one and _other forms and no bare base key', (base) => {
    expect(keys.has(`${base}_one`)).toBe(true);
    expect(keys.has(`${base}_other`)).toBe(true);
    expect(keys.has(base)).toBe(false);
  });

  it('resolves the form from the base key and count, keeping older base translations', async () => {
    await initializeI18n();
    await changeLanguageSafely('en');
    expect(i18n.t('com_ui_tools_count', { count: 1 })).toBe('1 tool');
    expect(i18n.t('com_ui_tools_count', { count: 2 })).toBe('2 tools');
    expect(i18n.t('com_ui_duration_announced_seconds', { count: 1, value: '1' })).toBe(
      'took 1 second',
    );
    expect(i18n.t('com_ui_duration_announced_seconds', { count: 1.4, value: '1.4' })).toBe(
      'took 1.4 seconds',
    );

    /** Only the configured interface locales are active. */
    await changeLanguageSafely('en');
    expect(i18n.t('com_ui_tools_count', { count: 2 })).toBe('2 tools');
    await changeLanguageSafely('en');
  });
});
