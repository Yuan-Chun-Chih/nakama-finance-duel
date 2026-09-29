"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  joinRealtimeMatch,
  type RelayedMatchSession,
} from "@/lib/nakama/service";

const MAX_RECONNECT_DELAY_MS = 8_000;

type FinanceMatchReconnectOptions = {
  matchId: string | null;
  connected: boolean;
  onReconnected: (session: RelayedMatchSession) => void;
};

// 以單一 in-flight join 搭配指數退避恢復對局，避免斷線時重複建立 socket。
export function useFinanceMatchReconnect({
  matchId,
  connected,
  onReconnected,
}: FinanceMatchReconnectOptions) {
  const [attempt, setAttempt] = useState(0);
  const [retryRevision, setRetryRevision] = useState(0);
  const inFlight = useRef(false);
  const handleReconnected = useEffectEvent(onReconnected);

  useEffect(() => {
    if (!matchId || connected) {
      inFlight.current = false;
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let currentAttempt = 0;

    const reconnect = async () => {
      if (cancelled) return;
      if (inFlight.current) {
        timer = setTimeout(reconnect, 250);
        return;
      }
      inFlight.current = true;
      setAttempt(currentAttempt + 1);

      try {
        const next = await joinRealtimeMatch(matchId);
        if (!cancelled) {
          setAttempt(0);
          handleReconnected(next);
        }
      } catch {
        if (!cancelled) {
          currentAttempt += 1;
          const baseDelay = Math.min(
            MAX_RECONNECT_DELAY_MS,
            1_000 * 2 ** Math.min(currentAttempt - 1, 3),
          );
          const jitter = Math.floor(Math.random() * 350);
          timer = setTimeout(reconnect, baseDelay + jitter);
        }
      } finally {
        inFlight.current = false;
      }
    };

    void reconnect();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [connected, matchId, retryRevision]);

  return {
    attempt: connected ? 0 : attempt,
    reconnecting: Boolean(matchId && !connected),
    retryNow: () => setRetryRevision((current) => current + 1),
  };
}
