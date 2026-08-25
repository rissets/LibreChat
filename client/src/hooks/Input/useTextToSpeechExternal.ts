import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { useToastContext } from '@librechat/client';
import { useTextToSpeechMutation, useVoicesQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import store from '~/store';

const createFormData = (text: string, voice: string) => {
  const formData = new FormData();
  formData.append('input', text);
  formData.append('voice', voice);
  return formData;
};

type TUseTTSExternal = {
  setIsSpeaking: React.Dispatch<React.SetStateAction<boolean>>;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  messageId?: string;
  isLast: boolean;
  index?: number;
};

function useTextToSpeechExternal({
  setIsSpeaking,
  audioRef,
  messageId,
  isLast,
  index = 0,
}: TUseTTSExternal) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const voice = useRecoilValue(store.voice);
  const cacheTTS = useRecoilValue(store.cacheTTS);
  const playbackRate = useRecoilValue(store.playbackRate);

  const [downloadFile, setDownloadFile] = useState(false);

  const promiseAudioRef = useRef<HTMLAudioElement | null>(null);

  /* Global Audio Variables */
  const globalIsFetching = useRecoilValue(store.globalAudioFetchingFamily(index));
  const globalIsPlaying = useRecoilValue(store.globalAudioPlayingFamily(index));

  const autoPlayAudio = async (blobUrl: string) => {
    const newAudio = new Audio(blobUrl);
    if (playbackRate != null && playbackRate !== 1 && playbackRate > 0) {
      newAudio.playbackRate = playbackRate;
    }
    audioRef.current = newAudio;
    promiseAudioRef.current = newAudio;
    newAudio.onended = () => {
      URL.revokeObjectURL(blobUrl);
      audioRef.current = null;
      promiseAudioRef.current = null;
      setIsSpeaking(false);
    };
    newAudio.onerror = () => {
      setIsSpeaking(false);
      showToast({
        message: localize('com_nav_audio_play_error', { 0: 'Audio tidak dapat diputar.' }),
        status: 'error',
      });
    };

    // The previous implementation only assigned the blob URL to a ref. No
    // play() call was made, so external TTS appeared to finish successfully
    // but users heard nothing. Start playback immediately and keep the audio
    // reference available for the stop button and autoplay-policy fallback.
    try {
      await newAudio.play();
      setIsSpeaking(true);
    } catch (error) {
      setIsSpeaking(false);
      showToast({
        message: localize('com_nav_audio_play_error', { 0: (error as Error).message }),
        status: 'error',
      });
    }
  };

  const playAudioPromise = (blobUrl: string) => {
    const newAudio = new Audio(blobUrl);
    const initializeAudio = () => {
      if (playbackRate != null && playbackRate !== 1 && playbackRate > 0) {
        newAudio.playbackRate = playbackRate;
      }
    };

    initializeAudio();
    audioRef.current = newAudio;
    const playPromise = () => newAudio.play().then(() => setIsSpeaking(true));

    playPromise().catch((error: Error) => {
      if (
        error.message &&
        error.message.includes('The play() request was interrupted by a call to pause()')
      ) {
        console.log('Play request was interrupted by a call to pause()');
        initializeAudio();
        return playPromise().catch(console.error);
      }
      console.error(error);
      showToast({
        message: localize('com_nav_audio_play_error', { 0: error.message }),
        status: 'error',
      });
    });

    newAudio.onended = () => {
      console.log('Cached message audio ended');
      URL.revokeObjectURL(blobUrl);
      audioRef.current = null;
      promiseAudioRef.current = null;
      setIsSpeaking(false);
    };

    promiseAudioRef.current = newAudio;
  };

  const downloadAudio = (blobUrl: string) => {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'audio.mp3';
    a.click();
    setDownloadFile(false);
  };

  const { mutate: processAudio, isLoading } = useTextToSpeechMutation({
    onMutate: (variables) => {
      const inputText = (variables.get('input') ?? '') as string;
      if (inputText.length >= 4096) {
        showToast({
          message: localize('com_nav_long_audio_warning'),
          status: 'warning',
        });
      }
    },
    onSuccess: async (data: ArrayBuffer, variables) => {
      try {
        const inputText = (variables.get('input') ?? '') as string;
        const audioBlob = new Blob([data], { type: 'audio/mpeg' });

        if (cacheTTS && inputText) {
          const cache = await caches.open('tts-responses');
          const request = new Request(inputText);
          const response = new Response(audioBlob);
          cache.put(request, response);
        }

        const blobUrl = URL.createObjectURL(audioBlob);
        if (downloadFile) {
          downloadAudio(blobUrl);
        }
        await autoPlayAudio(blobUrl);
      } catch (error) {
        showToast({
          message: `Error processing audio: ${(error as Error).message}`,
          status: 'error',
        });
      }
    },
    onError: (error: unknown) => {
      showToast({
        message: localize('com_nav_audio_process_error', { 0: (error as Error).message }),
        status: 'error',
      });
    },
  });

  const startMutation = (text: string, download: boolean) => {
    const formData = createFormData(text, voice ?? '');
    setDownloadFile(download);
    processAudio(formData);
  };

  const generateSpeechExternal = (text: string, download: boolean) => {
    if (cacheTTS) {
      handleCachedResponse(text, download);
    } else {
      startMutation(text, download);
    }
  };

  const handleCachedResponse = async (text: string, download: boolean) => {
    const cachedResponse = await caches.match(text);
    if (!cachedResponse) {
      return startMutation(text, download);
    }
    const audioBlob = await cachedResponse.blob();
    const blobUrl = URL.createObjectURL(audioBlob);
    if (download) {
      downloadAudio(blobUrl);
    } else {
      playAudioPromise(blobUrl);
    }
  };

  const cancelSpeech = () => {
    const messageAudio = document.getElementById(`audio-${messageId}`) as HTMLAudioElement | null;
    const pauseAudio = (currentElement: HTMLAudioElement | null) => {
      if (currentElement) {
        currentElement.pause();
        currentElement.src && URL.revokeObjectURL(currentElement.src);
        audioRef.current = null;
      }
    };
    pauseAudio(messageAudio);
    pauseAudio(promiseAudioRef.current);
    setIsSpeaking(false);
  };

  const cancelPromiseSpeech = useCallback(() => {
    if (promiseAudioRef.current) {
      promiseAudioRef.current.pause();
      promiseAudioRef.current.src && URL.revokeObjectURL(promiseAudioRef.current.src);
      promiseAudioRef.current = null;
      setIsSpeaking(false);
    }
  }, [setIsSpeaking]);

  useEffect(() => cancelPromiseSpeech, [cancelPromiseSpeech]);

  const isFetching = useMemo(
    () => isLast && globalIsFetching && !globalIsPlaying,
    [globalIsFetching, globalIsPlaying, isLast],
  );

  const { data: voicesData = [] } = useVoicesQuery();

  return {
    generateSpeechExternal,
    cancelSpeech,
    isLoading: isFetching || isLoading,
    audioRef,
    voices: voicesData,
  };
}

export default useTextToSpeechExternal;
