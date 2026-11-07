import { createContext, useContext } from 'react';
import type { TMeetingSession } from 'librechat-data-provider';
import type { useMeetingTranscript } from '~/data-provider/Meetings';
import type { MeetingMicrophone } from './capture';

export type TranscriptQuery = ReturnType<typeof useMeetingTranscript>;
export type SwitchGuard = () => boolean | Promise<boolean>;
interface ActiveMeeting {
  userId?: string;
  session: TMeetingSession | null;
  microphone: MeetingMicrophone | null;
  transcript: TranscriptQuery | null;
  attach: (session: TMeetingSession) => boolean;
  beforeSwitch: (guard: SwitchGuard) => () => void;
}
export const Context = createContext<ActiveMeeting | null>(null);
export const inactive: ActiveMeeting = {
  session: null,
  microphone: null,
  transcript: null,
  attach: () => false,
  beforeSwitch: () => () => undefined,
};

export function useMeetingRuntime() {
  const value = useContext(Context);
  if (!value) throw new Error('MEETING_RUNTIME_REQUIRED');
  return value;
}
export const useActiveMeeting = useMeetingRuntime;

export function useOptionalMeetingRuntime() {
  return useContext(Context);
}
