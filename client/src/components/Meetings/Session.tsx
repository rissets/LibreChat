import { useEffect, useState } from 'react';
import { Button } from '@librechat/client';
import { Link } from 'react-router-dom';
import type { TMeetingSession } from 'librechat-data-provider';
import { useMeetingRuntime } from './Runtime';
import { useLocalize } from '~/hooks';
import Workspace from './Workspace';

export default function Session({
  session,
  userId,
}: {
  session: TMeetingSession;
  userId?: string;
}) {
  const localize = useLocalize();
  const runtime = useMeetingRuntime();
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState(false);
  const { attach } = runtime;
  useEffect(() => {
    attach(session);
  }, [attach, session]);
  const microphone = runtime.session?.id === session.id ? runtime.microphone : null;
  if (!microphone) {
    return (
      <div role="status">
        {localize(
          runtime.session && runtime.session.id !== session.id
            ? 'com_meeting_runtime_other_active'
            : 'com_ui_loading',
        )}
        {runtime.session && runtime.session.id !== session.id && (
          <>
            <Link className="ml-2 underline" to={'/meetings/' + runtime.session.id}>
              {localize('com_meeting_runtime_return')}
            </Link>
            {runtime.microphone && (
              <Button
                className="ml-2"
                variant="outline"
                disabled={stopping}
                onClick={async () => {
                  if (
                    !window.confirm(
                      'Hentikan rekaman aktif? Audio yang belum terkirim akan diproses terlebih dahulu.',
                    )
                  )
                    return;
                  setStopping(true);
                  setStopError(false);
                  try {
                    if (!(await runtime.microphone?.stop())) setStopError(true);
                  } catch {
                    setStopError(true);
                  } finally {
                    setStopping(false);
                  }
                }}
              >
                Hentikan rekaman aktif
              </Button>
            )}
            {stopError && (
              <p role="alert">Rekaman belum dapat dihentikan. Periksa koneksi dan coba lagi.</p>
            )}
          </>
        )}
      </div>
    );
  }
  return <Workspace session={session} userId={userId} microphone={microphone} />;
}
