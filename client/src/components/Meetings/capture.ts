import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import type { TMeetingCapture, TMeetingTranscript } from 'librechat-data-provider';
import type { BufferedFrame, CaptureBuffer } from './buffer';
import { useMeetingAudio, useMeetingCapture, useMeetingLifecycle } from '~/data-provider/Meetings';
import { bufferEpoch, discardBuffer, readBuffer, saveBuffer } from './buffer';
import { subscribeMeetingAccessLoss } from '~/data-provider/Meetings/access';
import { meetingLimitError } from './limit-errors';
import { useMeetingAudioSession } from './audio';
import processorURL from './pcm.js?url';
import { wavBase64 } from './wav';

type CaptureState =
  | 'idle'
  | 'requesting'
  | 'checking'
  | 'capturing'
  | 'stopping'
  | 'stopped'
  | 'paused'
  | 'recoverable'
  | 'error';
type CaptureError =
  | 'permission'
  | 'unsupported'
  | 'device'
  | 'service'
  | 'capacity'
  | 'network'
  | 'storage'
  | 'duration'
  | 'concurrency'
  | 'access';
type Interruption = NonNullable<CaptureBuffer['interruption']>;
interface Resources {
  stream: MediaStream;
  context: AudioContext;
  processor: AudioWorkletNode;
  source: MediaStreamAudioSourceNode;
}
interface PCMMessage {
  type: 'frame' | 'level' | 'flushed';
  samples?: ArrayBuffer;
  level?: number;
}

export function useMicrophoneCapture(
  userId: string | undefined,
  id: string,
  snapshot?: TMeetingTranscript,
) {
  const [state, setState] = useState<CaptureState>('idle');
  const [error, setError] = useState<CaptureError | null>(null);
  const [level, setLevel] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [pending, setPending] = useState(0);
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(navigator.onLine);
  const resources = useRef<Resources | null>(null);
  const { claim: claimAudio, release: releaseAudio, stopAll } = useMeetingAudioSession();
  const audioToken = useRef<string | null>(null);
  const capture = useRef<TMeetingCapture | null>(null);
  const frames = useRef<BufferedFrame[]>([]);
  const interruption = useRef<Interruption | null>(null);
  const writes = useRef(Promise.resolve());
  const sending = useRef<Promise<boolean> | null>(null);
  const sequence = useRef(0);
  const flushing = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const mode = useRef<CaptureState>('idle');
  const retention = useRef(300);
  retention.current = snapshot?.recovery_retention_seconds ?? 300;
  const operation = useMeetingCapture(userId, id);
  const audio = useMeetingAudio(userId, id);
  const lifecycle = useMeetingLifecycle(userId, id, true);
  const api = useRef({
    change: operation.mutateAsync,
    submit: audio.mutateAsync,
    lifecycle: lifecycle.refetch,
  });
  api.current = {
    change: operation.mutateAsync,
    submit: audio.mutateAsync,
    lifecycle: lifecycle.refetch,
  };
  const key = (userId ?? '') + ':' + id;
  const storedEpoch = useRef(bufferEpoch(key));
  const supported =
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof window.AudioContext === 'function' &&
    typeof window.AudioWorkletNode === 'function';

  const status = useCallback((value: CaptureState) => {
    mode.current = value;
    if (mounted.current) setState(value);
  }, []);
  const persist = useCallback(() => {
    const value = { frames: [...frames.current], interruption: interruption.current };
    const epoch = storedEpoch.current;
    const seconds = retention.current;
    writes.current = writes.current
      .catch(() => undefined)
      .then(() => saveBuffer(key, value, seconds, epoch));
    return writes.current;
  }, [key]);
  const release = useCallback(() => {
    generation.current++;
    const current = resources.current;
    resources.current = null;
    releaseAudio(audioToken.current);
    audioToken.current = null;
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
    if (mounted.current) setLevel(0);
  }, [releaseAudio]);
  useEffect(
    () =>
      subscribeMeetingAccessLoss({ userId, meetingId: id }, (reason, change) => {
        if (reason === 'transport' || reason === 'hidden') return;
        if (
          reason === 'lifecycle' &&
          change &&
          change.value.classes.transcript?.available !== false &&
          change.value.classes.meeting?.available !== false
        ) {
          const seconds = change.value.policy.seconds.processing_audio;
          if (seconds != null) retention.current = Math.min(retention.current, seconds);
          const cutoffs = change.removals
            .filter((row) => row.artifact_class === 'processing_audio' && row.through_at)
            .map((row) => (row.through_at ? Date.parse(row.through_at) : 0));
          const cutoff = Math.max(0, ...cutoffs);
          const retained = frames.current.filter(
            (frame) =>
              frame.stored_at > cutoff &&
              Date.now() <
                Math.min(frame.expires_at ?? Infinity, frame.stored_at + retention.current * 1000),
          );
          if (retained.length === frames.current.length) return;
          frames.current = retained;
          interruption.current = 'buffer';
          setPending(retained.length);
          const erased = discardBuffer(key);
          storedEpoch.current = bufferEpoch(key);
          writes.current = Promise.all([writes.current.catch(() => undefined), erased]).then(
            () => undefined,
          );
          void persist().catch(() => {
            if (mounted.current) setError('storage');
          });
          return;
        }
        release();
        frames.current = [];
        capture.current = null;
        interruption.current = null;
        setPending(0);
        status('error');
        setError('access');
        const erased = discardBuffer(key);
        storedEpoch.current = bufferEpoch(key);
        writes.current = Promise.all([writes.current.catch(() => undefined), erased]).then(
          () => undefined,
        );
        void persist().catch(() => {
          if (mounted.current) setError('storage');
        });
      }),
    [id, key, persist, release, status, userId],
  );
  const interrupt = useCallback(
    (reason: CaptureError) => {
      release();
      status('error');
      if (mounted.current) setError(reason);
      const reasons: Partial<Record<CaptureError, Interruption>> = {
        permission: 'permission',
        device: 'device',
        network: 'network',
      };
      interruption.current = reasons[reason] ?? 'buffer';
      void persist().catch(() => {
        if (mounted.current) setError('storage');
      });
      if (capture.current && navigator.onLine) {
        void api.current
          .change({
            id,
            action: 'interrupt',
            capture_token: capture.current.capture_token,
            reason: interruption.current,
          })
          .catch(() => undefined);
      }
    },
    [id, persist, release, status],
  );

  const drain = useCallback((): Promise<boolean> => {
    if (sending.current) return sending.current;
    const send = async () => {
      while (frames.current.length) {
        if (!navigator.onLine) {
          if (mounted.current) setConnected(false);
          return false;
        }
        const frame = frames.current[0];
        if (
          Date.now() - frame.stored_at > retention.current * 1000 ||
          (frame.expires_at !== undefined && frame.expires_at <= Date.now())
        ) {
          frames.current = frames.current.filter((value) => value.chunk_id !== frame.chunk_id);
          interruption.current = 'buffer';
          await persist();
          if (mounted.current) setPending(frames.current.length);
          continue;
        }
        try {
          const checked = await api.current.lifecycle();
          if (checked.isError || !checked.data)
            throw checked.error ?? new Error('MEETING_LIFECYCLE_UNAVAILABLE');
          if (checked.data.classes.transcript?.available !== true) {
            frames.current = [];
            await discardBuffer(key);
            interrupt('access');
            return false;
          }
          const seconds = checked.data.policy.seconds.processing_audio;
          if (seconds !== null && seconds !== undefined)
            retention.current = Math.min(retention.current, seconds);
          if (bufferEpoch(key) !== storedEpoch.current) return false;
          if (Date.now() - frame.stored_at > retention.current * 1000) {
            frames.current = frames.current.filter((value) => value.chunk_id !== frame.chunk_id);
            interruption.current = 'buffer';
            await persist();
            if (mounted.current) setPending(frames.current.length);
            continue;
          }
          const { stored_at: _storedAt, expires_at: _expiresAt, ...body } = frame;
          const ack = await api.current.submit({ id, ...body });
          if (!ack.durable) throw new Error('MEETING_ACK_UNCONFIRMED');
          frames.current = frames.current.filter((value) => value.chunk_id !== frame.chunk_id);
          await persist();
          if (mounted.current) {
            setPending(frames.current.length);
            setConnected(true);
          }
          if (
            ack.state === 'rejected' &&
            ['MEETING_IDENTITY_DENIED', 'MEETING_POLICY_CHANGED', 'MEETING_ACCESS_DENIED'].includes(
              ack.error_code ?? '',
            )
          ) {
            interrupt('access');
            return false;
          }
        } catch (cause) {
          if (!mounted.current) return false;
          const limit = meetingLimitError(cause);
          if (limit) {
            interrupt(limit);
            return false;
          }
          setConnected(false);
          if (isAxiosError(cause) && [401, 403].includes(cause.response?.status ?? 0))
            interrupt('access');
          else if (isAxiosError(cause) && cause.response?.status === 429) interrupt('capacity');
          else if (
            isAxiosError(cause) &&
            [400, 409, 413, 422].includes(cause.response?.status ?? 0)
          )
            interrupt('service');
          else if (!isAxiosError(cause)) interrupt('storage');
          return false;
        }
      }
      return true;
    };
    sending.current = send().finally(() => {
      sending.current = null;
    });
    return sending.current;
  }, [id, interrupt, key, persist]);

  const open = useCallback(
    async (checking: boolean, resume = false) => {
      if (!supported || !ready) {
        setError(supported ? 'storage' : 'unsupported');
        status('error');
        return;
      }
      if (frames.current.length) {
        setError('network');
        status('recoverable');
        return;
      }
      release();
      audioToken.current = claimAudio('participant');
      if (!audioToken.current) {
        setError('service');
        status('error');
        return;
      }
      const opening = generation.current;
      status('requesting');
      setError(null);
      let stream: MediaStream | null = null;
      let context: AudioContext | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        if (!mounted.current || opening !== generation.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        context = new AudioContext({ sampleRate: 16000 });
        if (!context.audioWorklet) throw new Error('MEETING_UNSUPPORTED');
        await context.audioWorklet.addModule(processorURL);
        if (!mounted.current || opening !== generation.current) {
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
        const current = { stream, context, processor, source };
        resources.current = current;
        setDevices(
          (await navigator.mediaDevices.enumerateDevices()).filter(
            (value) => value.kind === 'audioinput',
          ),
        );
        if (!checking) {
          capture.current = await api.current.change({ id, action: resume ? 'resume' : 'start' });
          if (!mounted.current || opening !== generation.current) {
            release();
            void api.current
              .change({ id, action: 'interrupt', reason: 'browser_stopped' })
              .catch(() => undefined);
            return;
          }
          sequence.current = capture.current.next_sequence;
          interruption.current = null;
          await persist();
        }
        processor.port.onmessage = (event: MessageEvent<PCMMessage>) => {
          const message = event.data;
          if (message.type === 'level') {
            if (mounted.current) setLevel(Math.min(1, (message.level ?? 0) * 4));
            return;
          }
          if (message.type === 'flushed') {
            flushing.current?.();
            flushing.current = null;
            return;
          }
          if (checking || !message.samples || !capture.current || !resources.current) return;
          if (frames.current.length >= 5) {
            interrupt('capacity');
            return;
          }
          frames.current.push({
            capture_id: capture.current.id,
            capture_token: capture.current.capture_token,
            chunk_id: crypto.randomUUID(),
            sequence: sequence.current++,
            stored_at: Date.now(),
            audio_base64: wavBase64(new Float32Array(message.samples), current.context.sampleRate),
          });
          setPending(frames.current.length);
          void persist()
            .then(() => drain())
            .catch(() => interrupt('storage'));
        };
        for (const track of stream.getAudioTracks()) track.onended = () => interrupt('device');
        source.connect(processor);
        processor.connect(context.destination);
        await context.resume();
        status(checking ? 'checking' : 'capturing');
      } catch (cause) {
        if (opening !== generation.current) {
          stream?.getTracks().forEach((track) => track.stop());
          if (context && context !== resources.current?.context) void context.close();
          return;
        }
        if (resources.current) release();
        else {
          releaseAudio(audioToken.current);
          audioToken.current = null;
          stream?.getTracks().forEach((track) => track.stop());
          if (context) void context.close();
        }
        if (!mounted.current) return;
        let reason: CaptureError =
          meetingLimitError(cause) ??
          (isAxiosError(cause) && [401, 403].includes(cause.response?.status ?? 0)
            ? 'access'
            : 'service');
        if (cause instanceof DOMException)
          reason = ['NotAllowedError', 'SecurityError'].includes(cause.name)
            ? 'permission'
            : 'device';
        setError(reason);
        status('error');
      }
    },
    [
      claimAudio,
      releaseAudio,
      deviceId,
      drain,
      id,
      interrupt,
      persist,
      ready,
      release,
      status,
      supported,
    ],
  );

  const finish = useCallback(
    async (action: 'pause' | 'stop') => {
      if (mode.current === 'checking') {
        release();
        status('idle');
        return true;
      }
      const finishingCapture = capture.current;
      const opening = generation.current;
      if (!finishingCapture) return false;
      const current = resources.current;
      status('stopping');
      if (current) {
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
        if (
          !mounted.current ||
          generation.current !== opening ||
          capture.current !== finishingCapture
        )
          return false;
        release();
        if (!flushed) {
          interrupt('device');
          return false;
        }
      }
      const finishing = generation.current;
      try {
        await writes.current;
        const drained = await drain();
        if (
          !mounted.current ||
          generation.current !== finishing ||
          capture.current !== finishingCapture
        )
          return false;
        if (!drained && frames.current.length > 0) {
          if (!navigator.onLine) interrupt('network');
          else {
            status('recoverable');
            setError('service');
          }
          return false;
        }
        const updated = await api.current.change({
          id,
          action,
          capture_token: finishingCapture.capture_token,
        });
        if (
          !mounted.current ||
          generation.current !== finishing ||
          capture.current !== finishingCapture
        )
          return false;
        capture.current = updated;
        status(action === 'pause' ? 'paused' : 'stopped');
        return true;
      } catch (cause) {
        if (
          !mounted.current ||
          generation.current !== finishing ||
          capture.current !== finishingCapture
        )
          return false;
        interrupt(meetingLimitError(cause) ?? 'service');
        return false;
      }
    },
    [drain, id, interrupt, release, status],
  );

  const reconnect = useCallback(
    async (discard = false) => {
      status('stopping');
      setError(null);
      try {
        if (discard) {
          frames.current = [];
          interruption.current = 'buffer';
          await persist();
          setPending(0);
        }
        if (!(await drain())) {
          status('recoverable');
          setError('network');
          return;
        }
        capture.current = await api.current.change({
          id,
          action: 'recover',
          reason: interruption.current ?? 'browser_stopped',
        });
        sequence.current = capture.current.next_sequence;
        interruption.current = null;
        await persist();
        setConnected(true);
        status('paused');
      } catch (cause) {
        setError(
          meetingLimitError(cause) ??
            (isAxiosError(cause) && [401, 403].includes(cause.response?.status ?? 0)
              ? 'access'
              : 'service'),
        );
        status('error');
      }
    },
    [drain, id, persist, status],
  );

  const durationEnded = snapshot?.limits.error_code === 'MEETING_DURATION_LIMIT';
  const discardPending = useCallback(async () => {
    if (!durationEnded) return;
    frames.current = [];
    interruption.current = null;
    try {
      await persist();
      if (mounted.current) setPending(0);
    } catch {
      if (mounted.current) setError('storage');
    }
  }, [durationEnded, persist]);

  useEffect(() => {
    if (snapshot?.limits.error_code === 'MEETING_DURATION_LIMIT') {
      release();
      status('stopped');
      setError('duration');
      return;
    }
    if (snapshot?.limits.error_code === 'MEETING_CONCURRENCY_LIMIT' && resources.current) {
      interrupt('concurrency');
      return;
    }
    if (!resources.current && ['idle', 'recoverable'].includes(mode.current) && snapshot?.capture) {
      capture.current = snapshot.capture;
      status(['stopped', 'failed'].includes(snapshot.capture.state) ? 'stopped' : 'recoverable');
    }
    if (snapshot?.capture?.state === 'failed' && resources.current) interrupt('service');
  }, [interrupt, release, snapshot, status]);

  useEffect(() => {
    mounted.current = true;
    const reading = generation.current;
    const epoch = bufferEpoch(key);
    storedEpoch.current = epoch;
    void readBuffer(key, retention.current)
      .then((saved) => {
        if (!mounted.current || generation.current !== reading || bufferEpoch(key) !== epoch)
          return;
        frames.current = saved.frames;
        interruption.current = saved.interruption;
        setPending(saved.frames.length);
        setReady(true);
      })
      .catch(() => {
        if (mounted.current) {
          setError('storage');
          status('error');
        }
      });
    const devicesChanged = () =>
      void navigator.mediaDevices
        .enumerateDevices()
        .then((values) => {
          if (mounted.current) setDevices(values.filter((value) => value.kind === 'audioinput'));
        })
        .catch(() => undefined);
    if (supported) {
      devicesChanged();
      navigator.mediaDevices.addEventListener('devicechange', devicesChanged);
    }
    let permission: PermissionStatus | null = null;
    if (navigator.permissions)
      void navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((result) => {
          if (!mounted.current) return;
          permission = result;
          permission.onchange = () => {
            if (permission?.state === 'denied' && resources.current) interrupt('permission');
          };
        })
        .catch(() => undefined);
    const online = () => {
      setConnected(true);
      void drain();
    };
    const offline = () => setConnected(false);
    const leave = () => {
      interruption.current = 'browser_stopped';
      release();
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('pagehide', leave);
    const heartbeat = window.setInterval(() => {
      if (mode.current !== 'capturing' || !capture.current) return;
      void api.current
        .change({ id, action: 'heartbeat', capture_token: capture.current.capture_token })
        .catch((cause) => {
          const limit = meetingLimitError(cause);
          if (limit) interrupt(limit);
          else if (isAxiosError(cause) && [401, 403, 409].includes(cause.response?.status ?? 0))
            interrupt('access');
        });
      void drain();
    }, 10000);
    const expiry = window.setInterval(() => {
      const retained = frames.current.filter(
        (frame) =>
          Date.now() <
          Math.min(frame.expires_at ?? Infinity, frame.stored_at + retention.current * 1000),
      );
      if (retained.length === frames.current.length) return;
      frames.current = retained;
      interruption.current = 'buffer';
      setPending(retained.length);
      void persist().catch(() => {
        if (mounted.current) setError('storage');
      });
    }, 1000);
    return () => {
      mounted.current = false;
      release();
      window.clearInterval(heartbeat);
      window.clearInterval(expiry);
      if (permission) permission.onchange = null;
      if (supported) navigator.mediaDevices.removeEventListener('devicechange', devicesChanged);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener('pagehide', leave);
    };
  }, [drain, id, interrupt, key, persist, release, status, supported]);
  return {
    state,
    error,
    level,
    devices,
    deviceId,
    setDeviceId,
    supported,
    pending,
    ready,
    connected,
    check: () => open(true),
    start: () => open(false),
    resume: () => open(false, true),
    pause: () => finish('pause'),
    stop: () => {
      void stopAll();
      return finish('stop');
    },
    reconnect,
    discardPending,
  };
}
export type MeetingMicrophone = ReturnType<typeof useMicrophoneCapture>;
