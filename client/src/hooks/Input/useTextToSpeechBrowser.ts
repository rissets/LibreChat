import { useMemo, useSyncExternalStore } from 'react';
import { useRecoilValue } from 'recoil';
import type { VoiceOption } from '~/common';
import { subscribeSpeechVoices, getSpeechVoicesSnapshot } from '~/utils';
import store from '~/store';

function useTextToSpeechBrowser({
  setIsSpeaking,
}: {
  setIsSpeaking: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const voiceName = useRecoilValue(store.voice);
  const languageTTS = useRecoilValue(store.languageTTS);
  const cloudBrowserVoices = useRecoilValue(store.cloudBrowserVoices);
  const { voices: availableVoices, supported: isSpeechSynthesisSupported } = useSyncExternalStore(
    subscribeSpeechVoices,
    getSpeechVoicesSnapshot,
    getSpeechVoicesSnapshot,
  );

  const orderedVoices = useMemo(() => {
    const filteredVoices = availableVoices.filter(
      (v) => cloudBrowserVoices || v.localService === true,
    );
    // BP Chat is an Indonesian experience. Ignore a stale English value in
    // localStorage while still honoring an explicitly configured Indonesian
    // locale (id, id-ID, and regional variants).
    const configuredLanguage = String(languageTTS || '').trim();
    const preferredLanguage = configuredLanguage.toLowerCase().startsWith('id')
      ? configuredLanguage.toLowerCase()
      : 'id-id';
    return [...filteredVoices].sort((left, right) => {
      const leftPreferred = left.lang?.toLowerCase().startsWith(preferredLanguage) ? 0 : 1;
      const rightPreferred = right.lang?.toLowerCase().startsWith(preferredLanguage) ? 0 : 1;
      return leftPreferred - rightPreferred || left.name.localeCompare(right.name);
    });
  }, [availableVoices, cloudBrowserVoices, languageTTS]);

  const voices = useMemo(
    () => orderedVoices.map((v): VoiceOption => ({ value: v.name, label: v.name })),
    [orderedVoices],
  );

  const generateSpeechLocal = (text: string) => {
    if (!isSpeechSynthesisSupported) {
      console.warn('Speech synthesis is not supported');
      return;
    }

    const synth = window.speechSynthesis;
    const configuredLanguage = String(languageTTS || '').trim();
    const preferredLanguage = configuredLanguage.toLowerCase().startsWith('id')
      ? configuredLanguage.toLowerCase()
      : 'id-id';
    const preferred = orderedVoices.filter((v) => v.lang?.toLowerCase().startsWith(preferredLanguage));
    const selected =
      orderedVoices.find((v) => v.name === voiceName && (preferred.length === 0 || preferred.includes(v))) ||
      preferred[0] ||
      orderedVoices[0];

    try {
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      // Some browsers expose the voice list asynchronously. Do not fail
      // silently while it is still empty: the browser can still synthesize
      // with its default voice when the Indonesian locale is requested.
      utterance.lang = preferredLanguage || selected?.lang || 'id-ID';
      utterance.voice = selected
        ? synth.getVoices().find((v) => v.name === selected.name) || null
        : null;
      utterance.onend = () => {
        setIsSpeaking(false);
      };
      utterance.onerror = (event) => {
        if (event.error === 'interrupted' || event.error === 'canceled') {
          setIsSpeaking(false);
          return;
        }

        console.error('Speech synthesis error:', event);
        setIsSpeaking(false);
      };
      setIsSpeaking(true);
      synth.speak(utterance);
    } catch (error) {
      console.error('Error generating speech:', error);
      setIsSpeaking(false);
    }
  };

  const cancelSpeechLocal = () => {
    if (!isSpeechSynthesisSupported) {
      return;
    }

    try {
      window.speechSynthesis.cancel();
    } catch (error) {
      console.error('Error cancelling speech:', error);
    } finally {
      setIsSpeaking(false);
    }
  };

  return { generateSpeechLocal, cancelSpeechLocal, voices, isSpeechSynthesisSupported };
}

export default useTextToSpeechBrowser;
