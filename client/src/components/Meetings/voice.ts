import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import type { MeetingMicrophone } from './capture';
import {
  useBeginMeetingVoice,
  useCancelMeetingVoice,
  useMeetingVoice,
  useMeetingLifecycle,
  useSubmitMeetingVoice,
} from '~/data-provider/Meetings';
import { subscribeMeetingAccessLoss } from '~/data-provider/Meetings/access';
import { useMeetingAudioSession } from './audio';
import processorURL from './pcm.js?url';
import { wavBase64 } from './wav';

type VoiceState =
  | 'idle'
  | 'preparing'
  | 'requesting'
  | 'recording'
  | 'sending'
  | 'processing'
  | 'cancelled'
  | 'failed';
type VoiceError = 'permission' | 'device' | 'service' | 'delivery' | 'unsupported';
interface Resources {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: AudioWorkletNode;
}

/** Only an explicit button opens this bounded recorder. Audio remains in memory until acceptance. */
export function useVoiceQuestion(
  userId: string | undefined,
  id: string,
  microphone: MeetingMicrophone,
) {
  const history = useMeetingVoice(userId, id);
  const lifecycle = useMeetingLifecycle(userId, id, true);
  const rawSeconds = useRef<number | null>(null);
  rawSeconds.current = lifecycle.data?.policy.seconds.processing_audio ?? null;
  const { refetch: refresh } = history;
  const begin = useBeginMeetingVoice(userId, id);
  const submit = useSubmitMeetingVoice(userId, id);
  const cancellation = useCancelMeetingVoice(userId, id);
  const { claim: claimAudio, release: releaseAudio, onStop } = useMeetingAudioSession();
  const api = useRef({
    begin: begin.mutateAsync,
    submit: submit.mutateAsync,
    cancel: cancellation.mutateAsync,
  });
  api.current = {
    begin: begin.mutateAsync,
    submit: submit.mutateAsync,
    cancel: cancellation.mutateAsync,
  };
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<VoiceError | null>(null);
  const [maximum, setMaximum] = useState(20);
  const [level, setLevel] = useState(0);
  const mode = useRef<VoiceState>('idle');
  const resources = useRef<Resources | null>(null);
  const token = useRef<string | null>(null);
  const operation = useRef<string | null>(null);
  const began = useRef(0);
  const voiceLease = useRef(0);
  const payloadBegan = useRef(0);
  const payloadExpiry = useRef(0);
  const generation = useRef(0);
  const chunks = useRef<Float32Array[]>([]);
  const samples = useRef(0);
  const limit = useRef(0);
  const timer = useRef<number | null>(null);
  const flushing = useRef<(() => void) | null>(null);
  const payload = useRef<{ operationId: string; audio_base64: string } | null>(null);
  const mounted = useRef(true);
  const supported = microphone.supported;
  const status = useCallback((value: VoiceState) => {
    mode.current = value;
    if (mounted.current) setState(value);
  }, []);
  const release = useCallback(
    (releaseOwner = true) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      const current = resources.current;
      resources.current = null;
      if (current) {
        for (const track of current.stream.getTracks()) {
          track.onended = null;
          track.stop();
        }
        current.source.disconnect();
        current.processor.disconnect();
        current.processor.port.onmessage = null;
        current.processor.port.close();
        void current.context.close();
      }
      if (releaseOwner) {
        releaseAudio(token.current);
        token.current = null;
      }
      if (mounted.current) setLevel(0);
    },
    [releaseAudio],
  );
  const cancel = useCallback(
    (reason?: VoiceError) => {
      const submitted =
        payload.current !== null || ['sending', 'processing'].includes(mode.current);
      generation.current++;
      const attempt = generation.current;
      release();
      chunks.current = [];
      samples.current = 0;
      payload.current = null;
      let next: VoiceState = reason ? 'failed' : 'cancelled';
      if (!reason && submitted) next = 'processing';
      status(next);
      if (mounted.current) setError(reason ?? null);
      return operation.current
        ? api.current
            .cancel({ id, operationId: operation.current })
            .then((value) => {
              if (attempt !== generation.current) return value;
              if (!reason && value.state === 'cancelled') status('cancelled');
              return value;
            })
            .catch((cause) => {
              if (attempt !== generation.current) return;
              if (isAxiosError(cause) && cause.response?.status === 409) {
                status('processing');
                if (mounted.current) setError(null);
                void refresh();
              } else if (submitted) {
                status('failed');
                if (mounted.current) setError('delivery');
              }
            })
        : Promise.resolve();
    },
    [id, refresh, release, status],
  );

  const discard = useCallback(() => {
    generation.current++;
    release();
    flushing.current?.();
    flushing.current = null;
    chunks.current = [];
    samples.current = 0;
    payload.current = null;
    operation.current = null;
    status('failed');
    if (mounted.current) setError('service');
    // An accepted owner attempt is not a browser lease: no cancellation/redispatch here.
  }, [release, status]);
  useEffect(
    () =>
      subscribeMeetingAccessLoss({ userId, meetingId: id }, (reason, change) => {
        if (reason === 'lifecycle' && change && change.value.classes.answers?.available !== false) {
          const seconds = change.value.policy.seconds.processing_audio;
          if (payload.current && seconds != null)
            payloadExpiry.current = Math.min(
              payloadExpiry.current,
              payloadBegan.current + seconds * 1000,
            );
          const removed = change.removals.some(
            (row) =>
              row.artifact_class === 'processing_audio' &&
              (row.artifact_id === 'voice:' + operation.current ||
                row.artifact_id === '*' ||
                (row.through_at && began.current <= Date.parse(row.through_at))),
          );
          if (!removed) return;
        }
        if (reason !== 'transport') discard();
      }),
    [discard, id, userId],
  );

  const deliver = useCallback(async () => {
    const body = payload.current;
    if (!body) return;
    if (Date.now() >= payloadExpiry.current) {
      discard();
      return;
    }
    const attempt = generation.current;
    status('sending');
    setError(null);
    try {
      await api.current.submit({ id, ...body });
      if (attempt !== generation.current) return;
      release();
      payload.current = null;
      status('processing');
    } catch {
      if (attempt !== generation.current) return;
      status('failed');
      if (mounted.current) setError('delivery');
    }
  }, [discard, id, release, status]);
  const send = useCallback(async () => {
    if (mode.current !== 'recording' || !resources.current) return;
    const current = resources.current;
    const attempt = generation.current;
    status('sending');
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const flushed = await new Promise<boolean>((resolve) => {
      const timeout = window.setTimeout(() => {
        flushing.current = null;
        resolve(false);
      }, 1000);
      flushing.current = () => {
        window.clearTimeout(timeout);
        resolve(true);
      };
      current.processor.port.postMessage('flush');
    });
    if (attempt !== generation.current) return;
    release(false);
    if (!flushed || !samples.current || !operation.current) {
      cancel('device');
      return;
    }
    const pcm = new Float32Array(samples.current);
    let offset = 0;
    for (const chunk of chunks.current) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }
    chunks.current = [];
    samples.current = 0;
    payload.current = {
      operationId: operation.current,
      audio_base64: wavBase64(pcm, current.context.sampleRate),
    };
    payloadBegan.current = Date.now();
    payloadExpiry.current = Math.min(
      voiceLease.current,
      rawSeconds.current === null ? Infinity : payloadBegan.current + rawSeconds.current * 1000,
    );
    await deliver();
  }, [cancel, deliver, release, status]);
  const sendCurrent = useRef(send);
  sendCurrent.current = send;
  const start = async () => {
    if (['preparing', 'requesting', 'recording', 'sending', 'processing'].includes(mode.current))
      return;
    if (!supported) {
      setError('unsupported');
      status('failed');
      return;
    }
    status('preparing');
    setError(null);
    operation.current = null;
    payload.current = null;
    const attempt = ++generation.current;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      if (microphone.state === 'capturing' && !(await microphone.pause()))
        throw new Error('MEETING_PAUSE_REQUIRED');
      if (attempt !== generation.current) return;
      token.current = claimAudio('question');
      if (!token.current) throw new Error('MEETING_AUDIO_BUSY');
      const operationId = crypto.randomUUID();
      began.current = Date.now();
      operation.current = operationId;
      const accepted = await api.current.begin({ id, operation_id: operationId });
      if (attempt !== generation.current || !mounted.current) {
        void api.current.cancel({ id, operationId }).catch(() => undefined);
        return;
      }
      if (accepted.state !== 'recording') throw new Error('MEETING_VOICE_NOT_RECORDING');
      voiceLease.current = Date.parse(accepted.lease_until);
      setMaximum(accepted.max_seconds);
      status('requesting');
      timer.current = window.setTimeout(() => cancel('device'), accepted.max_seconds * 1000);
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(microphone.deviceId ? { deviceId: { exact: microphone.deviceId } } : {}),
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (attempt !== generation.current || !mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      context = new AudioContext({ sampleRate: 16000 });
      await context.audioWorklet.addModule(processorURL);
      if (attempt !== generation.current || !mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        void context.close();
        return;
      }
      const processor = new AudioWorkletNode(context, 'meeting-pcm', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const source = context.createMediaStreamSource(stream);
      resources.current = { stream, context, processor, source };
      chunks.current = [];
      samples.current = 0;
      limit.current = Math.min(context.sampleRate * accepted.max_seconds, 480000);
      processor.port.onmessage = (
        event: MessageEvent<{ type: string; samples?: ArrayBuffer; level?: number }>,
      ) => {
        if (event.data.type === 'flushed') {
          flushing.current?.();
          flushing.current = null;
        } else if (event.data.type === 'level') {
          if (mounted.current) setLevel(Math.min(1, (event.data.level ?? 0) * 4));
        } else if (event.data.samples && ['recording', 'sending'].includes(mode.current)) {
          const chunk = new Float32Array(event.data.samples).slice(
            0,
            Math.max(0, limit.current - samples.current),
          );
          chunks.current.push(chunk);
          samples.current += chunk.length;
          if (samples.current >= limit.current) void sendCurrent.current();
        }
      };
      for (const track of stream.getAudioTracks()) track.onended = () => cancel('device');
      source.connect(processor);
      processor.connect(context.destination);
      await context.resume();
      if (attempt !== generation.current) return;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(
        () => void sendCurrent.current(),
        accepted.max_seconds * 1000,
      );
      status('recording');
    } catch (cause) {
      if (attempt !== generation.current) return;
      stream?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      if (context && context !== resources.current?.context) void context.close();
      let reason: VoiceError = 'service';
      if (cause instanceof DOMException)
        reason = ['NotAllowedError', 'SecurityError'].includes(cause.name)
          ? 'permission'
          : 'device';
      cancel(reason);
    }
  };

  useEffect(() => {
    mounted.current = true;
    const expiry = window.setInterval(() => {
      if (payload.current && Date.now() >= payloadExpiry.current) discard();
    }, 1000);
    const leave = () => cancel();
    window.addEventListener('pagehide', leave);
    return () => {
      mounted.current = false;
      window.clearInterval(expiry);
      cancel();
      window.removeEventListener('pagehide', leave);
    };
  }, [cancel, discard]);
  useEffect(
    () =>
      onStop(() =>
        ['preparing', 'requesting', 'recording'].includes(mode.current)
          ? cancel()
          : Promise.resolve(),
      ),
    [cancel, onStop],
  );
  useEffect(() => {
    const current = history.data?.questions.find((question) => question.id === operation.current);
    if (current && ['completed', 'cancelled', 'rejected', 'uncertain'].includes(current.state)) {
      generation.current++;
      release();
      payload.current = null;
      if (current.state === 'completed') status('idle');
      else if (current.state === 'cancelled' && mode.current !== 'failed') status('cancelled');
      else if (current.state === 'cancelled') return;
      else {
        status('failed');
        setError('service');
      }
    }
    if (
      history.isError &&
      isAxiosError<{ code?: string }>(history.error) &&
      ([401, 403, 404].includes(history.error.response?.status ?? 0) ||
        [
          'MEETING_SOURCE_UNAVAILABLE',
          'MEETING_AUDIO_EXPIRED',
          'MEETING_LIFECYCLE_POLICY_REQUIRED',
        ].includes(history.error.response?.data?.code ?? ''))
    )
      discard();
  }, [discard, history.data, history.error, history.isError, release, status]);
  return {
    state,
    error,
    level,
    maximum,
    supported,
    history,
    saved: history.data?.questions.find((question) => question.id === operation.current),
    start,
    send,
    cancel,
    retry: deliver,
    canRetry: payload.current !== null,
    cancelAbandoned: (operationId: string) => cancellation.mutate({ id, operationId }),
  };
}
