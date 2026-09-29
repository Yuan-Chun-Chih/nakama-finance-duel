"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  CandlestickChart,
  Clock3,
  RefreshCw,
  Swords,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  cancelRealtimeMatchmaking,
  clearRealtimeMatchResume,
  FINANCE_MATCH_OP_CODES,
  joinRealtimeMatch,
  leaveRealtimeMatch,
  listFinanceHistory,
  listMatchCandles,
  persistRealtimeMatchResume,
  restoreRealtimeMatchResume,
  sendRealtimeMatchData,
  startFinanceMatchmaking,
  subscribeToRealtimeMatchData,
  subscribeToRealtimeMatchPresence,
  subscribeToRealtimeMatchmaker,
  subscribeToRealtimeConnection,
  updateFinanceMatchmaking,
  type DashboardSnapshot,
  type FinanceMatchEventView,
  type FinanceMatchStateView,
  type FinanceHistoryPage,
  type MatchCandleView,
  type RelayedMatchSession,
} from "@/lib/nakama/service";
import { restoreLiveSession } from "@/lib/nakama/client";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ActionConfirmDialog,
  GameStartCountdownDialog,
  MatchConfirmationDialog,
} from "@/components/finance-duel/finance-duel-dialogs";
import { FinanceTradeTicket } from "@/components/finance-duel/finance-trade-ticket";
import { useFinanceMatchReconnect } from "@/components/finance-duel/use-finance-match-reconnect";

type FinanceOperation =
  | "matchmaking"
  | "leave"
  | "ready"
  | "match_cancel"
  | "order"
  | "cancel_order"
  | "resign";

const EMPTY_STATE: FinanceMatchStateView = {
  kind: "finance_state",
  arenaId: "",
  status: "waiting",
  players: [],
  usernames: {},
  ready: {},
  online: {},
  portfolios: {},
  openOrders: [],
  round: 0,
  remainingSeconds: 0,
  countdownSeconds: 0,
  priceCents: 0,
  priceUpdatedAt: "",
  marketStale: true,
  winnerUserIds: [],
  finishReason: "",
  serverTick: 0,
  stateVersion: 0,
  opponentLeadStatus: "even",
};

// FinanceDuelMatchPanel 只送出玩家意圖，所有盤面、成交與勝負均以 authoritative snapshot 為準。
export function FinanceDuelMatchPanel({
  snapshot,
  disabled,
  onDuelPresentationChange,
}: {
  snapshot: DashboardSnapshot | null;
  disabled: boolean;
  onDuelPresentationChange?: (active: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<RelayedMatchSession | null>(null);
  const [game, setGame] = useState<FinanceMatchStateView>(EMPTY_STATE);
  const [events, setEvents] = useState<FinanceMatchEventView[]>([]);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState(0.1);
  const [pendingOperation, setPendingOperation] =
    useState<FinanceOperation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backgroundNotice, setBackgroundNotice] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [hasLiveAuth, setHasLiveAuth] = useState(false);
  const [candles, setCandles] = useState<MatchCandleView[]>([]);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [history, setHistory] = useState<FinanceHistoryPage | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [matchmakerTicket, setMatchmakerTicket] = useState<string | null>(null);
  const [searchStartedAt, setSearchStartedAt] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [pendingAction, setPendingAction] = useState<"resign" | "leave" | null>(
    null,
  );
  const [matchmakingNotice, setMatchmakingNotice] = useState<string | null>(
    null,
  );
  const [matchmakingRevision, setMatchmakingRevision] = useState(0);
  const [connected, setConnected] = useState(true);
  const [mobileTab, setMobileTab] = useState<MobileArenaTab>("market");
  const cancellationHandled = useRef(false);
  const latestStateVersion = useRef(-1);
  const actionInFlight = useRef(false);
  const historyRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeMatchId = session?.matchId ?? null;
  const { attempt: reconnectAttempt, reconnecting, retryNow } =
    useFinanceMatchReconnect({
      matchId: activeMatchId,
      connected,
      onReconnected: (next) => {
        latestStateVersion.current = -1;
        setSession(next);
        setConnected(true);
      },
    });
  const selfUserId = session?.self.userId ?? snapshot?.profile?.id ?? "";
  const selfPortfolio = selfUserId ? game.portfolios[selfUserId] : undefined;
  const opponentId = game.players.find((id) => id !== selfUserId) ?? "";
  const selfReady = Boolean(game.ready[selfUserId]);
  const immersiveDuel = Boolean(
    session && (game.status === "countdown" || game.status === "running"),
  );
  const serverPrice = fromCents(game.priceCents);
  const maxQuantity = useMemo(() => {
    if (!selfPortfolio) return 0;
    const selfOrders = game.openOrders.filter(
      (order) => order.userId === selfUserId,
    );
    if (side === "sell") {
      const reservedSell = selfOrders
        .filter((order) => order.side === "sell")
        .reduce(
          (sum, order) => sum + fromMicros(order.remainingQuantityMicros),
          0,
        );
      return Math.max(
        0,
        fromMicros(selfPortfolio.quantityMicros) - reservedSell,
      );
    }
    const reservedBuy = selfOrders
      .filter((order) => order.side === "buy")
      .reduce(
        (sum, order) =>
          sum +
          fromMicros(order.remainingQuantityMicros) *
            (fromCents(order.limitPriceCents) || serverPrice) *
            1.0008,
        0,
      );
    return Math.max(
      0,
      (fromCents(selfPortfolio.cashCents) - reservedBuy) /
        (Math.max(1, serverPrice) * 1.0008),
    );
  }, [game.openOrders, selfPortfolio, selfUserId, serverPrice, side]);
  const effectiveQuantity = Math.max(0.000001, Math.min(quantity, maxQuantity));
  const estimatedNotional = effectiveQuantity * serverPrice;
  const estimatedFee = estimatedNotional * 0.0008;
  const estimatedTax = side === "sell" ? estimatedNotional * 0.001 : 0;
  const indicators = useMemo(() => buildIndicators(candles), [candles]);
  const tradeDisabledReason = pendingOperation === "order"
    ? "Submitting your last request..."
    : game.status !== "running"
      ? "Orders unlock when the opening countdown finishes."
      : game.marketStale
        ? "Trading is paused until the server receives a fresh BTC price."
        : !selfPortfolio || maxQuantity < 0.000001
          ? side === "buy"
            ? "No available cash for a minimum BTC order."
            : "No BTC position is available to sell."
          : null;
  const waitingSeconds = searchStartedAt
    ? Math.max(
        0,
        Math.floor((clockNow - new Date(searchStartedAt).getTime()) / 1000),
      )
    : 0;
  const marketAgeSeconds = game.priceUpdatedAt
    ? Math.max(
        0,
        Math.floor((clockNow - new Date(game.priceUpdatedAt).getTime()) / 1000),
      )
    : null;

  // Wait for local auth restoration before background RPCs. This prevents a
  // first render from showing a matchmaking/history error before Match is used.
  useEffect(() => {
    let cancelled = false;
    void restoreLiveSession()
      .catch(() => null)
      .then((next) => {
        if (!cancelled) {
          setHasLiveAuth(Boolean(next));
          setAuthReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!matchmakerTicket || !searchStartedAt) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [matchmakerTicket, searchStartedAt]);

  // The arena shell keeps navigation visible, but frees its title space once a duel is underway.
  useEffect(() => {
    onDuelPresentationChange?.(immersiveDuel);
  }, [immersiveDuel, onDuelPresentationChange]);

  useEffect(
    () => () => {
      onDuelPresentationChange?.(false);
    },
    [onDuelPresentationChange],
  );

  // K 線刷新由 authoritative round / price snapshot 觸發，不使用獨立瀏覽器計時器。
  useEffect(() => {
    if (!activeMatchId || !game.priceUpdatedAt) return;
    let cancelled = false;
    void listMatchCandles({ symbol: "BTC/USDT", limit: 80 })
      .then((next) => {
        if (!cancelled) {
          setCandles(next);
          setMarketError(null);
        }
      })
      .catch((reason) => {
        if (!cancelled) setMarketError(describeError(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [activeMatchId, game.priceUpdatedAt]);

  // 只接受與當前 matchmakerTicket 相符的配對，避免舊配對覆蓋新配對。
  useEffect(
    () =>
      subscribeToRealtimeMatchmaker((matched) => {
        if (!matchmakerTicket || matched.ticket !== matchmakerTicket) return;
        cancellationHandled.current = false;
        latestStateVersion.current = -1;
        setMatchmakerTicket(null);
        setSearchStartedAt(null);
        setMatchmakingNotice("Opponent found. Confirm within 30 seconds.");
        void joinRealtimeMatch(matched.match_id, matched.token)
          .then((next) => {
            setSession(next);
            persistRealtimeMatchResume({
              matchId: next.matchId,
              gameType: "finance",
            });
          })
          .catch((reason) => setError(describeError(reason)));
      }),
    [matchmakerTicket],
  );

  // Backend projection survives a browser refresh even though the native matchmaker ticket does not.
  useEffect(() => {
    if (!authReady || !hasLiveAuth || disabled || session || matchmakerTicket)
      return;
    let cancelled = false;
    let retryTimer: number | null = null;
    void updateFinanceMatchmaking("status")
      .then(async (status) => {
        if (cancelled) return;
        if (
          (status.status === "matched" || status.status === "running") &&
          status.matchId
        ) {
          const next = await joinRealtimeMatch(status.matchId);
          if (!cancelled) {
            setSession(next);
            persistRealtimeMatchResume({
              matchId: next.matchId,
              gameType: "finance",
            });
          }
          return;
        }
        if (status.status === "matching") {
          setMatchmakingNotice(
            "Opponent found. Finalizing the authoritative room...",
          );
          retryTimer = window.setTimeout(
            () => setMatchmakingRevision((current) => current + 1),
            500,
          );
          return;
        }
        if (status.status === "searching") {
          setMatchmakingNotice(
            "Restored search from the authoritative queue state.",
          );
          setSearchStartedAt(
            status.searchStartedAt ??
              status.updatedAt ??
              new Date().toISOString(),
          );
          if (!status.queueToken)
            throw new Error("Backend matchmaking queue token is missing.");
          const ticket = await startFinanceMatchmaking(status.queueToken);
          if (!cancelled) setMatchmakerTicket(ticket.ticket);
          return;
        }
        if (status.status === "cooldown" && status.cooldownUntil) {
          setMatchmakingNotice(
            `Matchmaking cooldown until ${new Date(status.cooldownUntil).toLocaleTimeString("zh-TW")}.`,
          );
          return;
        }
        const resume = restoreRealtimeMatchResume();
        if (resume?.gameType === "finance") {
          const next = await joinRealtimeMatch(resume.matchId);
          if (!cancelled) setSession(next);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setBackgroundNotice(
            `Previous matchmaking state could not be restored: ${describeError(reason)}`,
          );
        }
      });
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [
    authReady,
    disabled,
    hasLiveAuth,
    matchmakerTicket,
    matchmakingRevision,
    session,
  ]);

  // WebSocket snapshot 是畫面唯一狀態來源；event opcode 只負責即時稽核訊息。
  useEffect(() => {
    if (!activeMatchId) return;
    const unsubscribeData = subscribeToRealtimeMatchData(
      activeMatchId,
      (event) => {
        if (
          event.opCode === FINANCE_MATCH_OP_CODES.state &&
          isFinanceState(event.payload)
        ) {
          const version =
            event.payload.stateVersion ?? event.payload.serverTick;
          if (version <= latestStateVersion.current) return;
          latestStateVersion.current = version;
          setClockNow(Date.now());
          setGame(event.payload);
          return;
        }
        if (
          event.opCode === FINANCE_MATCH_OP_CODES.event &&
          isFinanceEventEnvelope(event.payload)
        ) {
          const next = event.payload.event;
          setEvents((current) =>
            [
              next,
              ...current.filter((item) => item.sequence !== next.sequence),
            ].slice(0, 16),
          );
          if (next.type.startsWith("order_") || next.type === "match_finished") {
            if (historyRefreshTimer.current) {
              clearTimeout(historyRefreshTimer.current);
            }
            const delay = next.type === "match_finished" ? 0 : 350;
            historyRefreshTimer.current = setTimeout(
              () => setHistoryRevision((current) => current + 1),
              delay,
            );
          }
        }
      },
    );
    const unsubscribePresence = subscribeToRealtimeMatchPresence(
      activeMatchId,
      (event) => {
        setSession((current) =>
          current
            ? {
                ...current,
                presences: event.presences,
                size: event.presences.length,
              }
            : current,
        );
      },
    );
    void sendRealtimeMatchData(
      activeMatchId,
      FINANCE_MATCH_OP_CODES.stateRequest,
      { kind: "finance_state_request" },
    );
    return () => {
      unsubscribeData();
      unsubscribePresence();
      if (historyRefreshTimer.current) {
        clearTimeout(historyRefreshTimer.current);
        historyRefreshTimer.current = null;
      }
    };
  }, [activeMatchId]);

  useEffect(() => subscribeToRealtimeConnection(setConnected), []);

  // The backend decides who canceled. The remaining confirmed player is returned to the FIFO queue automatically.
  useEffect(() => {
    if (!session || game.status !== "canceled" || cancellationHandled.current)
      return;
    cancellationHandled.current = true;
    const selfCanceled =
      game.canceledByUserId === selfUserId ||
      (!selfReady && !game.canceledByUserId);
    void leaveRealtimeMatch(session.matchId).finally(() => {
      clearRealtimeMatchResume();
      setSession(null);
      setGame(EMPTY_STATE);
      if (selfCanceled) {
        router.back();
        return;
      }
      setMatchmakingNotice("Opponent canceled. Returning to the queue...");
      void updateFinanceMatchmaking("status")
        .then((status) => {
          if (!status.queueToken)
            throw new Error("Backend matchmaking queue token is missing.");
          return startFinanceMatchmaking(status.queueToken);
        })
        .then((ticket) => setMatchmakerTicket(ticket.ticket))
        .catch((reason) =>
          setBackgroundNotice(`Queue re-entry unavailable: ${describeError(reason)}`),
        );
    });
  }, [
    game.canceledByUserId,
    game.status,
    router,
    selfReady,
    selfUserId,
    session,
  ]);

  // 戰績與完整交易紀錄來自後端 projection/history RPC，不從畫面事件自行累計。
  useEffect(() => {
    if (!authReady || disabled || !activeMatchId) return;
    let cancelled = false;
    void listFinanceHistory({ arenaId: game.arenaId || undefined, limit: 10 })
      .then((next) => {
        if (!cancelled) setHistory(next);
      })
      .catch((reason) => {
        if (!cancelled) {
          setBackgroundNotice(`History refresh unavailable: ${describeError(reason)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeMatchId, authReady, disabled, game.arenaId, historyRevision]);

  // 使用 Nakama StorageList cursor 向後讀取歷史頁面，並以 arenaId 避免重複對局。
  async function loadMoreHistory() {
    if (!history?.cursor || historyLoadingMore) return;
    setHistoryLoadingMore(true);
    setError(null);
    try {
      const next = await listFinanceHistory({
        arenaId: game.arenaId || undefined,
        limit: 10,
        cursor: history.cursor,
      });
      setHistory((current) =>
        current
          ? {
              ...next,
              games: [
                ...current.games,
                ...next.games.filter(
                  (gameRecord) =>
                    !current.games.some(
                      (item) => item.arenaId === gameRecord.arenaId,
                    ),
                ),
              ],
            }
          : next,
      );
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setHistoryLoadingMore(false);
    }
  }
  // 用於封裝 async action 的 busy / error 狀態，避免重複程式碼。
  // 集中處理按鈕操作的 loading 與錯誤狀態，避免每個 action 重複 try/catch。
  async function run(
    operation: FinanceOperation,
    action: () => Promise<void>,
  ) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setPendingOperation(operation);
    setError(null);
    setBackgroundNotice(null);
    try {
      await action();
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      actionInFlight.current = false;
      setPendingOperation(null);
    }
  }
  // 按下「尋找對手」後，會呼叫後端 matchmaking API，並在畫面顯示等待訊息。
  // 使用者可在對局中重新整理頁面，並自動恢復對局狀態，避免因網路中斷或瀏覽器崩潰而失去進度。
  async function findOpponent() {
    await run("matchmaking", async () => {
      cancellationHandled.current = false;
      setMatchmakingNotice("Searching for the next available opponent...");
      const status = await updateFinanceMatchmaking("begin");
      if (!status.queueToken)
        throw new Error("Backend matchmaking queue token is missing.");
      const ticket = await startFinanceMatchmaking(status.queueToken);
      setSearchStartedAt(
        status.searchStartedAt ?? status.updatedAt ?? new Date().toISOString(),
      );
      setMatchmakerTicket(ticket.ticket);
    });
  } // 取消搜尋對手，若已經配對成功則會取消對局，並返回 FIFO 隊列。
  async function cancelSearch() {
    if (!matchmakerTicket) return;
    await run("matchmaking", async () => {
      await cancelRealtimeMatchmaking(matchmakerTicket);
      await updateFinanceMatchmaking("cancel");
      setMatchmakerTicket(null);
      setSearchStartedAt(null);
      setMatchmakingNotice(null);
    });
  }
  // 用於建立新的 authoritative finance match，若有社群 context 則建立社群房間。

  // 用於加入對局，若有社群 context 則加入社群房間。

  // 用於離開對局，離開後清除 localStorage，避免重新整理後自動加入已離開的對局。
  async function leaveMatch() {
    if (!session) return;
    await run("leave", async () => {
      await leaveRealtimeMatch(session.matchId);
      clearRealtimeMatchResume();
      setSession(null);
      setGame(EMPTY_STATE);
      setEvents([]);
    });
  }
  // 用於切換 Ready 狀態，Ready 由 server snapshot 同步，避免雙方 Ready 不一致。
  async function toggleReady() {
    if (!session) return;
    await run("ready", () =>
      sendRealtimeMatchData(session.matchId, FINANCE_MATCH_OP_CODES.ready, {
        kind: "finance_ready",
        ready: !selfReady,
      }),
    );
  }
  async function cancelMatchedGame() {
    if (!session) return;
    await run("match_cancel", async () => {
      cancellationHandled.current = true;
      await sendRealtimeMatchData(
        session.matchId,
        FINANCE_MATCH_OP_CODES.matchCancel,
        { kind: "finance_match_cancel" },
      );
      await leaveRealtimeMatch(session.matchId);
      clearRealtimeMatchResume();
      setSession(null);
      setGame(EMPTY_STATE);
      router.back();
    });
  }
  // 用於提交買賣單，買賣單由 server snapshot 同步，避免雙方持倉不一致。
  async function submitOrder() {
    if (!session) return;
    await run("order", () =>
      sendRealtimeMatchData(session.matchId, FINANCE_MATCH_OP_CODES.order, {
        kind: "finance_order",
        side,
        orderType: "market",
        quantityMicros: toMicros(effectiveQuantity),
        limitPriceCents: 0,
        clientOrderId: crypto.randomUUID(),
      }),
    );
  }
  // 用於取消買賣單，買賣單由 server snapshot 同步，避免雙方持倉不一致。
  async function cancelOrder(orderId: string) {
    if (!session) return;
    await run("cancel_order", () =>
      sendRealtimeMatchData(session.matchId, FINANCE_MATCH_OP_CODES.cancel, {
        kind: "finance_cancel",
        orderId,
      }),
    );
  }
  // 用於棄權對局，棄權由 server snapshot 同步，避免雙方勝負不一致。
  async function resignMatch() {
    if (!session) return;
    await run("resign", () =>
      sendRealtimeMatchData(session.matchId, FINANCE_MATCH_OP_CODES.resign, {
        kind: "finance_resign",
      }),
    );
  }
  async function confirmResign() {
    setPendingAction("resign");
  }
  async function confirmLeaveMatch() {
    setPendingAction("leave");
  }
  async function executePendingAction() {
    const action = pendingAction;
    setPendingAction(null);
    if (action === "resign") await resignMatch();
    if (action === "leave") await leaveMatch();
  }
  // 用於關閉社群房間，僅房主可操作，避免雙方 Ready 不一致。
  const resultText =
    game.status === "finished"
      ? game.winnerUserIds.length > 1
        ? "Draw"
        : game.winnerUserIds.includes(selfUserId)
          ? "You win"
          : "You lose"
      : null;
  if (!pathname.startsWith("/matches")) {
    return (
      <Card className="border-cyan-400/20 bg-card/90">
        <CardContent className="flex flex-col items-start gap-3 p-6">
          <h2 className="text-xl font-semibold">BTC Duel Arena</h2>
          <p className="text-sm text-slate-400">
            Matchmaking and live trading run in a dedicated immersive arena.
          </p>
          <Button asChild>
            <Link href="/matches">Open arena</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  // 用於顯示指標數值，若為 null 則顯示 "--"。
  return (
    <div className="space-y-5 pb-28 md:pb-0">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {backgroundNotice && !error ? <Alert>{backgroundNotice}</Alert> : null}
      {session && reconnecting ? (
        <Alert className="flex items-center justify-between gap-3" aria-live="polite">
          <span>
            Connection interrupted. Rejoining and requesting the latest
            snapshot{reconnectAttempt ? ` (attempt ${reconnectAttempt})` : ""}.
          </span>
          <Button size="sm" variant="outline" onClick={retryNow}>
            <RefreshCw className="size-4" />
            Retry now
          </Button>
        </Alert>
      ) : null}
      {session && game.status === "running" && game.marketStale ? (
        <Alert variant="destructive">
          Market data is stale. The authoritative server has paused all new
          orders until a fresh BTC price arrives.
        </Alert>
      ) : null}
      {!session ? (
        <FinanceMatchmakingPanel
          busy={pendingOperation === "matchmaking"}
          disabled={disabled}
          notice={matchmakingNotice}
          searching={Boolean(matchmakerTicket)}
          waitingSeconds={waitingSeconds}
          onCancel={cancelSearch}
          onFind={findOpponent}
        />
      ) : (
        <>
          {pendingAction ? (
            <ActionConfirmDialog
              action={pendingAction}
              running={game.status === "running"}
              busy={
                pendingOperation === "resign" || pendingOperation === "leave"
              }
              onCancel={() => setPendingAction(null)}
              onConfirm={executePendingAction}
            />
          ) : null}
          {game.status === "matched_confirming" ? (
            <MatchConfirmationDialog
              busy={
                pendingOperation === "ready" ||
                pendingOperation === "match_cancel"
              }
              countdown={game.countdownSeconds}
              opponentName={game.usernames[opponentId] || "Opponent"}
              opponentReady={Boolean(game.ready[opponentId])}
              selfReady={selfReady}
              onCancel={cancelMatchedGame}
              onConfirm={toggleReady}
            />
          ) : null}
          {game.status === "countdown" ? (
            <GameStartCountdownDialog seconds={game.countdownSeconds} />
          ) : null}
          <MobileArenaTabs active={mobileTab} onChange={setMobileTab} />
          <div className="sticky top-11 z-20 grid grid-cols-2 overflow-hidden rounded-xl border border-white/10 bg-card/95 shadow-xl backdrop-blur md:top-0 sm:grid-cols-3 xl:grid-cols-5">
            <Stat
              label="Status"
              value={
                resultText ??
                (game.status === "countdown"
                  ? `starts in ${game.countdownSeconds}s`
                  : game.status)
              }
              icon={<Activity className="size-4" />}
            />
            <Stat
              label="Round"
              value={`${game.round || 0} / 30`}
              icon={<Clock3 className="size-4" />}
            />
            <Stat
              label="Time"
              value={`${game.remainingSeconds}s`}
              icon={<Clock3 className="size-4" />}
            />
            <Stat
              label="BTC/USDT"
              value={money(serverPrice)}
              icon={<CandlestickChart className="size-4" />}
            />
            <Stat
              label="Players"
              value={`${game.players.length} / 2`}
              icon={<Swords className="size-4" />}
            />
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
            <div className="min-w-0 space-y-3">
              <div // maket 面板在手機版隱藏，交易面板在手機版顯示，桌面版兩者皆顯示。
                className={mobileTab === "market" ? "block" : "hidden md:block"}
              >
                <MarketPanel
                  candles={candles}
                  fills={(history?.fills ?? []).filter(
                    (fill) => fill.userId === selfUserId,
                  )}
                  indicators={indicators}
                  error={marketError}
                  serverPrice={serverPrice}
                  updatedAt={game.priceUpdatedAt}
                  marketStale={game.marketStale}
                  busy={
                    pendingOperation === "resign" || pendingOperation === "leave"
                  }
                  canResign={game.status === "running"}
                  onLeave={confirmLeaveMatch}
                  onResign={confirmResign}
                />
              </div>
            </div>
            <aside className="flex flex-col gap-3 xl:sticky xl:top-3 xl:max-h-[calc(100vh-1.5rem)] xl:overflow-y-auto xl:pr-1">
              <Card
                className={`${mobileTab === "portfolio" ? "block" : "hidden md:block"} order-2 border-white/10 bg-card`}
              >
                <CardHeader>
                  <CardTitle>Inventory &amp; P&amp;L</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                  <Portfolio
                    title="You"
                    portfolio={selfPortfolio}
                    ready={selfReady}
                  />
                  <OpponentSummary
                    title={game.usernames[opponentId] || "Waiting for opponent"}
                    online={Boolean(game.online[opponentId])}
                    ready={Boolean(game.ready[opponentId])}
                    leadStatus={game.opponentLeadStatus}
                  />
                </CardContent>
              </Card>

              <FinanceTradeTicket
                mobileOpen={mobileTab === "trade"}
                side={side}
                quantity={quantity}
                effectiveQuantity={effectiveQuantity}
                maxQuantity={maxQuantity}
                availableCash={fromCents(selfPortfolio?.cashCents ?? 0)}
                marketAgeSeconds={marketAgeSeconds}
                estimatedNotional={estimatedNotional}
                estimatedFee={estimatedFee}
                estimatedTax={estimatedTax}
                disabledReason={tradeDisabledReason}
                submitting={pendingOperation === "order"}
                onClose={() => setMobileTab("market")}
                onQuantityChange={setQuantity}
                onSideChange={setSide}
                onSubmit={submitOrder}
              />
              <Card
                className={`${mobileTab === "trade" ? "block" : "hidden md:block"} order-4 border-white/10 bg-card`}
              >
                <CardHeader>
                  <CardTitle>Open orders</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {game.openOrders
                    .filter((order) => order.userId === selfUserId)
                    .map((order) => (
                      <div
                        className="flex items-center justify-between rounded-lg border border-white/10 p-3 text-sm"
                        key={order.id}
                      >
                        <span>
                          {order.side}{" "}
                          {btc(fromMicros(order.remainingQuantityMicros))} BTC @{" "}
                          {order.limitPriceCents
                            ? money(fromCents(order.limitPriceCents))
                            : "market"}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pendingOperation === "cancel_order"}
                          onClick={() => cancelOrder(order.id)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ))}
                  {!game.openOrders.some(
                    (order) => order.userId === selfUserId,
                  ) ? (
                    <p className="text-sm text-slate-500">No open orders.</p>
                  ) : null}
                </CardContent>
              </Card>
            </aside>
          </div>
          <div
            className={mobileTab === "history" ? "block md:hidden" : "hidden"}
          >
            <ExchangeHistoryPanel history={history} selfUserId={selfUserId} />
          </div>
          <div className="hidden gap-3 md:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
            <ExecutionLedger history={history} selfUserId={selfUserId} />
            <PerformanceSummary history={history} selfUserId={selfUserId} />
          </div>
          <div
            className={`${mobileTab === "history" ? "grid" : "hidden md:grid"} gap-3 lg:grid-cols-2`}
          >
            <FinanceRecordPanel
              history={history}
              selfUserId={selfUserId}
              loadingMore={historyLoadingMore}
              onLoadMore={loadMoreHistory}
            />
            <LiveServerEvents events={events} />
          </div>
        </>
      )}
    </div>
  );
}

type MobileArenaTab = "market" | "trade" | "portfolio" | "history";

function FinanceMatchmakingPanel({
  busy,
  disabled,
  notice,
  searching,
  waitingSeconds,
  onCancel,
  onFind,
}: {
  busy: boolean;
  disabled: boolean;
  notice: string | null;
  searching: boolean;
  waitingSeconds: number;
  onCancel: () => Promise<void>;
  onFind: () => Promise<void>;
}) {
  return (
    <Card className="border-cyan-400/20 bg-card/90">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Swords className="size-5 text-cyan-300" />
          BTC Duel Matchmaking
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="min-h-12 min-w-36"
              disabled={disabled || busy || searching}
              onClick={() => void onFind()}
            >
              {busy && !searching ? "Joining queue..." : "Match"}
            </Button>
            {searching ? (
              <Button
                className="min-h-12"
                variant="outline"
                disabled={busy}
                onClick={() => void onCancel()}
              >
                Cancel search
              </Button>
            ) : null}
          </div>
          {searching ? (
            <div
              className="flex items-center gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/5 p-3 text-cyan-100"
              role="timer"
              aria-label={`Searching for opponent, elapsed time ${formatDuration(waitingSeconds)}`}
            >
              <Clock3 className="size-4" />
              <span className="text-sm">Searching for opponent</span>
              <strong className="ml-auto font-mono tabular-nums">
                {formatDuration(waitingSeconds)}
              </strong>
            </div>
          ) : null}
          {notice ? (
            <p className="text-sm text-cyan-200" aria-live="polite">
              {notice}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">
            FIFO matchmaking
          </h3>
          <p className="text-sm text-slate-400">
            The first two eligible players are paired. Both have 30 seconds to
            confirm, followed by a separate 3-second start countdown.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
// MobileArenaTabs 只在手機版顯示，方便切換市場、交易、持倉與歷史紀錄面板。
function MobileArenaTabs({
  active,
  onChange,
}: {
  active: MobileArenaTab;
  onChange: (tab: MobileArenaTab) => void;
}) {
  return (
    <div
      className="sticky top-0 z-30 grid grid-cols-4 gap-1 rounded-xl border border-white/10 bg-slate-950/95 p-1 backdrop-blur md:hidden"
      role="tablist"
      aria-label="Duel workspace"
    >
      {(["market", "trade", "portfolio", "history"] as const).map((tab) => (
        <Button
          key={tab}
          className="min-h-11 capitalize"
          role="tab"
          aria-selected={active === tab}
          variant={active === tab ? "secondary" : "ghost"}
          onClick={() => onChange(tab)}
        >
          {tab}
        </Button>
      ))}
    </div>
  );
}

// Type definitions for market indicators
// 技術指標是從後端 candle feed 衍生的只讀情報，不會參與後端撮合或結算。
type MarketIndicators = {
  sma5: number | null;
  sma20: number | null;
  ema12: number | null;
  rsi14: number | null;
  macd: number | null;
  signal: number | null;
  volatility: number | null;
  trend: "bullish" | "bearish" | "neutral";
};
// Component for displaying market indicators
// 顯示行情 freshness、K 線、成交量與技術指標；交易是否可用仍由 server 的 marketStale 決定。
function MarketPanel({
  candles,
  fills,
  indicators,
  error,
  serverPrice,
  updatedAt,
  marketStale,
  busy,
  canResign,
  onLeave,
  onResign,
}: {
  candles: MatchCandleView[];
  fills: FinanceHistoryPage["fills"];
  indicators: MarketIndicators;
  error: string | null;
  serverPrice: number;
  updatedAt: string;
  marketStale: boolean;
  busy: boolean;
  canResign: boolean;
  onLeave: () => Promise<void>;
  onResign: () => Promise<void>;
}) {
  // 計算移動平均線
  const visible = candles.slice(-50);
  const width = 900;
  const height = 320;
  const priceBottom = 235;
  const plotLeft = 14;
  const plotRight = 886;
  const highs = visible.map((item) => item.high);
  const lows = visible.map((item) => item.low);
  const maxPrice = Math.max(...highs, serverPrice, 1);
  const minPrice = Math.min(...lows, serverPrice || maxPrice);
  const range = Math.max(1, maxPrice - minPrice);
  const maxVolume = Math.max(...visible.map((item) => item.volume), 1);
  const candleWidth = Math.max(
    3,
    ((plotRight - plotLeft) / Math.max(1, visible.length)) * 0.58,
  );
  const x = (index: number) =>
    plotLeft +
    ((plotRight - plotLeft) * (index + 0.5)) / Math.max(1, visible.length);
  const y = (price: number) =>
    12 + ((maxPrice - price) / range) * (priceBottom - 20);
  const closes = visible.map((item) => item.close);
  const sma5 = movingAverageSeries(closes, 5);
  const sma20 = movingAverageSeries(closes, 20);
  const tradeMarkers = fills.slice(-20).map((fill) => {
    const executedAt = new Date(fill.executedAt).getTime();
    let candleIndex = 0;
    let distance = Number.POSITIVE_INFINITY;
    visible.forEach((candle, index) => {
      const candleTime =
        candle.timestamp < 1_000_000_000_000
          ? candle.timestamp * 1000
          : candle.timestamp;
      const nextDistance = Math.abs(candleTime - executedAt);
      if (nextDistance < distance) {
        distance = nextDistance;
        candleIndex = index;
      }
    });
    return { ...fill, candleIndex, chartPrice: fromCents(fill.priceCents) };
  });

  return (
    <Card className="overflow-hidden border-white/10 bg-card/90">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CardTitle>BTC market intelligence</CardTitle>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy || !canResign}
            onClick={() => void onResign()}
          >
            Resign
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void onLeave()}
          >
            Leave match
          </Button>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-white">{money(serverPrice)}</p>
          <p
            className={
              marketStale ? "text-xs text-rose-300" : "text-xs text-slate-500"
            }
          >
            {marketStale
              ? "STALE - trading paused"
              : updatedAt
                ? new Date(updatedAt).toLocaleTimeString("zh-TW")
                : "waiting for price"}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          <Indicator
            label="Trend"
            value={indicators.trend}
            tone={
              indicators.trend === "bullish"
                ? "up"
                : indicators.trend === "bearish"
                  ? "down"
                  : "flat"
            }
          />
          <Indicator label="SMA 5" value={indicatorMoney(indicators.sma5)} />
          <Indicator label="SMA 20" value={indicatorMoney(indicators.sma20)} />
          <Indicator label="EMA 12" value={indicatorMoney(indicators.ema12)} />
          <Indicator
            label="RSI 14"
            value={indicatorNumber(indicators.rsi14)}
            tone={
              (indicators.rsi14 ?? 50) >= 70
                ? "down"
                : (indicators.rsi14 ?? 50) <= 30
                  ? "up"
                  : "flat"
            }
          />
          <Indicator
            label="MACD / Signal"
            value={`${indicatorNumber(indicators.macd)} / ${indicatorNumber(indicators.signal)}`}
          />
          <Indicator
            label="Volatility"
            value={
              indicators.volatility === null
                ? "--"
                : `${indicators.volatility.toFixed(2)}%`
            }
          />
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-2">
          {visible.length ? (
            <svg
              className="h-auto w-full"
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label="BTC candlestick and volume chart"
            >
              {[0, 1, 2, 3, 4].map((line) => (
                <line
                  key={line}
                  x1={plotLeft}
                  x2={plotRight}
                  y1={18 + line * 52}
                  y2={18 + line * 52}
                  stroke="rgba(148,163,184,.12)"
                />
              ))}
              {visible.map((candle, index) => {
                const rising = candle.close >= candle.open;
                const color = rising ? "#2dd4bf" : "#fb7185";
                const bodyTop = y(Math.max(candle.open, candle.close));
                const bodyHeight = Math.max(
                  2,
                  Math.abs(y(candle.open) - y(candle.close)),
                );
                const volumeHeight = (candle.volume / maxVolume) * 52;
                return (
                  <g key={`${candle.round}:${candle.timestamp}`}>
                    <title>
                      {`${new Date(candle.timestamp < 1_000_000_000_000 ? candle.timestamp * 1000 : candle.timestamp).toLocaleString("zh-TW")} · O ${candle.open} H ${candle.high} L ${candle.low} C ${candle.close}`}
                    </title>
                    <line
                      x1={x(index)}
                      x2={x(index)}
                      y1={y(candle.high)}
                      y2={y(candle.low)}
                      stroke={color}
                      strokeWidth="1.4"
                    />
                    <rect
                      x={x(index) - candleWidth / 2}
                      y={bodyTop}
                      width={candleWidth}
                      height={bodyHeight}
                      rx="1"
                      fill={color}
                    />
                    <rect
                      x={x(index) - candleWidth / 2}
                      y={height - 8 - volumeHeight}
                      width={candleWidth}
                      height={volumeHeight}
                      fill={color}
                      opacity=".35"
                    />
                  </g>
                );
              })}
              <path
                d={seriesPath(sma5, x, y)}
                fill="none"
                stroke="#facc15"
                strokeWidth="2"
              />
              <path
                d={seriesPath(sma20, x, y)}
                fill="none"
                stroke="#60a5fa"
                strokeWidth="2"
              />
              {tradeMarkers.map((fill) => {
                const markerX = x(fill.candleIndex);
                const markerY = y(fill.chartPrice);
                const color = fill.side === "buy" ? "#2dd4bf" : "#fb7185";
                return (
                  <g key={fill.id}>
                    <line
                      x1={markerX}
                      x2={markerX}
                      y1={markerY - 18}
                      y2={markerY - 5}
                      stroke={color}
                      strokeDasharray="2 2"
                    />
                    <path
                      d={
                        fill.side === "buy"
                          ? `M${markerX - 5},${markerY - 18} L${markerX + 5},${markerY - 18} L${markerX},${markerY - 8} Z`
                          : `M${markerX - 5},${markerY + 18} L${markerX + 5},${markerY + 18} L${markerX},${markerY + 8} Z`
                      }
                      fill={color}
                    />
                    <title>{`${fill.side.toUpperCase()} ${btc(fromMicros(fill.quantityMicros))} BTC @ ${money(fill.chartPrice)}`}</title>
                  </g>
                );
              })}
              <text x="22" y="30" fill="#facc15" fontSize="11">
                SMA 5
              </text>
              <text x="72" y="30" fill="#60a5fa" fontSize="11">
                SMA 20
              </text>
              <text x="22" y="306" fill="#64748b" fontSize="11">
                VOLUME
              </text>
            </svg>
          ) : (
            <div className="grid h-72 place-items-center text-sm text-slate-500">
              Waiting for backend candles.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
// 市場情報卡共用元件，以 tone 區分偏多、偏空與中性。
function Indicator({
  label,
  value,
  tone = "flat",
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "flat";
}) {
  const toneClass =
    tone === "up"
      ? "text-teal-300"
      : tone === "down"
        ? "text-rose-300"
        : "text-slate-100";
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <p className="text-[10px] uppercase tracking-[.18em] text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-sm font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

// 顯示後端 stats projection 與 cursor 分頁後的個人歷史戰績。
function FinanceRecordPanel({
  history,
  selfUserId,
  loadingMore,
  onLoadMore,
}: {
  history: FinanceHistoryPage | null;
  selfUserId: string;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const stats = history?.stats;
  const averageReturn = stats?.games
    ? stats.totalReturnBps / stats.games / 100
    : 0;
  return (
    <Card className="border-white/10 bg-card/90">
      <CardHeader>
        <CardTitle>Finance rating & record</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Metric
            label="Rating"
            value={
              stats ? `${stats.rating} (${signed(stats.ratingDelta)})` : "--"
            }
          />
          <Metric label="Games" value={`${stats?.games ?? 0}`} />
          <Metric
            label="W / L / D"
            value={`${stats?.wins ?? 0} / ${stats?.losses ?? 0} / ${stats?.draws ?? 0}`}
          />
          <Metric label="Avg. return" value={`${averageReturn.toFixed(2)}%`} />
          <Metric
            label="Best return"
            value={`${((stats?.bestReturnBps ?? 0) / 100).toFixed(2)}%`}
          />
        </div>
        <div className="space-y-2">
          {(history?.games ?? []).slice(0, 5).map((game) => {
            const result =
              game.winnerUserIds.length !== 1
                ? "Draw"
                : game.winnerUserIds[0] === selfUserId
                  ? "Win"
                  : "Loss";
            const rating = game.ratings.find(
              (item) => item.userId === selfUserId,
            );
            return (
              <div
                className="flex items-center justify-between rounded-lg border border-white/10 p-2 text-xs"
                key={game.arenaId}
              >
                <span>
                  {result} · {game.finishReason}
                </span>
                <span className="text-slate-400">
                  {rating ? signed(rating.delta) : "--"} ·{" "}
                  {new Date(game.finishedAt).toLocaleString("zh-TW")}
                </span>
              </div>
            );
          })}
          {!history?.games.length ? (
            <p className="text-sm text-slate-500">
              No completed finance games.
            </p>
          ) : null}
          {history?.cursor ? (
            <Button
              className="w-full"
              variant="outline"
              disabled={loadingMore}
              onClick={onLoadMore}
            >
              {loadingMore ? "Loading..." : "Load older games"}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// 將後端保存的 orders、fills 與 round snapshots 整理成稽核紀錄和績效面板。
function ExchangeHistoryPanel({
  history,
  selfUserId,
}: {
  history: FinanceHistoryPage | null;
  selfUserId: string;
}) {
  const snapshots = (history?.portfolioSnapshots ?? []).filter(
    (item) => item.portfolio.userId === selfUserId,
  );
  const performance = buildPortfolioPerformance(snapshots);
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <Card className="border-white/10 bg-card/90 xl:col-span-3">
        <CardHeader>
          <CardTitle>Portfolio performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric
              label="Latest NAV"
              value={money(fromCents(performance.latestNavCents))}
            />
            <Metric
              label="Realized P&L"
              value={money(fromCents(performance.latestRealizedCents))}
            />
            <Metric
              label="Unrealized P&L"
              value={money(fromCents(performance.latestUnrealizedCents))}
            />
            <Metric
              label="Max drawdown"
              value={`${(performance.maxDrawdownBps / 100).toFixed(2)}%`}
            />
          </div>
          <PortfolioPerformanceChart points={performance.points} />
        </CardContent>
      </Card>
      <Card className="border-white/10 bg-card/90">
        <CardHeader>
          <CardTitle>Order history</CardTitle>
        </CardHeader>
        <CardContent className="max-h-96 space-y-2 overflow-y-auto">
          {(history?.orders ?? [])
            .filter((order) => order.userId === selfUserId)
            .map((order) => (
              <div
                className="rounded-lg border border-white/10 p-3 text-xs"
                key={order.id}
              >
                <div className="flex justify-between">
                  <span
                    className={
                      order.side === "buy" ? "text-teal-300" : "text-rose-300"
                    }
                  >
                    {order.side.toUpperCase()}{" "}
                    {btc(fromMicros(order.quantityMicros))} BTC
                  </span>
                  <Badge variant="outline">{order.status}</Badge>
                </div>
                <p className="mt-1 text-slate-400">
                  {order.orderType} · limit{" "}
                  {order.limitPriceCents
                    ? money(fromCents(order.limitPriceCents))
                    : "market"}{" "}
                  · round {order.round}
                </p>
                {order.reason ? (
                  <p className="mt-1 text-amber-300">{order.reason}</p>
                ) : null}
              </div>
            ))}
          {!history?.orders.length ? (
            <p className="text-sm text-slate-500">No orders recorded.</p>
          ) : null}
        </CardContent>
      </Card>
      <Card className="border-white/10 bg-card/90">
        <CardHeader>
          <CardTitle>Trade history</CardTitle>
        </CardHeader>
        <CardContent className="max-h-96 space-y-2 overflow-y-auto">
          {(history?.fills ?? [])
            .filter((fill) => fill.userId === selfUserId)
            .map((fill) => (
              <div
                className="rounded-lg border border-white/10 p-3 text-xs"
                key={fill.id}
              >
                <div className="flex justify-between">
                  <span
                    className={
                      fill.side === "buy" ? "text-teal-300" : "text-rose-300"
                    }
                  >
                    {fill.side.toUpperCase()}{" "}
                    {btc(fromMicros(fill.quantityMicros))} BTC
                  </span>
                  <span>{money(fromCents(fill.priceCents))}</span>
                </div>
                <p className="mt-1 text-slate-400">
                  Notional {money(fromCents(fill.notionalCents))} · fee{" "}
                  {money(fromCents(fill.feeCents))} · tax{" "}
                  {money(fromCents(fill.taxCents))} · slippage{" "}
                  {money(fromCents(fill.slippageCents))}
                </p>
                <p className="mt-1 text-slate-500">
                  Round {fill.round} ·{" "}
                  {new Date(fill.executedAt).toLocaleTimeString("zh-TW")}
                </p>
              </div>
            ))}
          {!history?.fills.length ? (
            <p className="text-sm text-slate-500">No fills recorded.</p>
          ) : null}
        </CardContent>
      </Card>
      <Card className="border-white/10 bg-card/90">
        <CardHeader>
          <CardTitle>Round portfolio snapshots</CardTitle>
        </CardHeader>
        <CardContent className="max-h-96 space-y-2 overflow-y-auto">
          {snapshots.map((item) => (
            <div
              className="grid grid-cols-3 gap-2 rounded-lg border border-white/10 p-3 text-xs"
              key={`${item.round}:${item.portfolio.userId}`}
            >
              <Metric
                label={`Round ${item.round}`}
                value={money(fromCents(item.priceCents))}
              />
              <Metric
                label="NAV"
                value={money(fromCents(item.portfolio.navCents))}
              />
              <Metric
                label="Unrealized"
                value={money(fromCents(item.portfolio.unrealizedPnlCents))}
              />
            </div>
          ))}
          {!snapshots.length ? (
            <p className="text-sm text-slate-500">
              Snapshots appear after round 1 starts.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

// 單一回合的前端績效投影；原始數值都來自 server portfolio snapshot。
function ExecutionLedger({
  history,
  selfUserId,
}: {
  history: FinanceHistoryPage | null;
  selfUserId: string;
}) {
  const orders = (history?.orders ?? []).filter(
    (item) => item.userId === selfUserId,
  );
  const fills = (history?.fills ?? []).filter(
    (item) => item.userId === selfUserId,
  );
  return (
    <Card className="overflow-hidden border-white/10 bg-card">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Transaction records</CardTitle>
        <Badge variant="outline">{fills.length} fills</Badge>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[30rem] overflow-auto">
          <table className="w-full min-w-[880px] text-left text-xs">
            <thead className="sticky top-0 z-10 bg-muted text-[10px] uppercase tracking-[.14em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Side</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Quantity</th>
                <th className="px-4 py-3">Notional</th>
                <th className="px-4 py-3">Fee</th>
                <th className="px-4 py-3">Tax</th>
                <th className="px-4 py-3">Round / time</th>
              </tr>
            </thead>
            <tbody>
              {fills.map((fill, index) => (
                <tr
                  className="border-t border-white/8 transition-colors hover:bg-white/[0.035]"
                  key={fill.id}
                >
                  <td className="px-4 py-3 text-slate-500">{index + 1}</td>
                  <td
                    className={`px-4 py-3 font-semibold ${fill.side === "buy" ? "text-emerald-300" : "text-rose-300"}`}
                  >
                    {fill.side.toUpperCase()}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-100">
                    {money(fromCents(fill.priceCents))}
                  </td>
                  <td className="px-4 py-3">
                    {btc(fromMicros(fill.quantityMicros))}
                  </td>
                  <td className="px-4 py-3">
                    {money(fromCents(fill.notionalCents))}
                  </td>
                  <td className="px-4 py-3">
                    {money(fromCents(fill.feeCents))}
                  </td>
                  <td className="px-4 py-3">
                    {money(fromCents(fill.taxCents))}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    R{fill.round} ·{" "}
                    {new Date(fill.executedAt).toLocaleTimeString("zh-TW")}
                  </td>
                </tr>
              ))}
              {!fills.length ? (
                <tr>
                  <td
                    className="px-4 py-10 text-center text-slate-500"
                    colSpan={8}
                  >
                    Fills will appear here after an order executes.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="border-t border-white/10 bg-black/10 px-4 py-3 text-xs text-slate-400">
          Orders: {orders.length} · Filled:{" "}
          {orders.filter((item) => item.status === "filled").length} · Open:{" "}
          {
            orders.filter(
              (item) => item.status === "open" || item.status === "partial",
            ).length
          }
        </div>
      </CardContent>
    </Card>
  );
}

function PerformanceSummary({
  history,
  selfUserId,
}: {
  history: FinanceHistoryPage | null;
  selfUserId: string;
}) {
  const snapshots = (history?.portfolioSnapshots ?? []).filter(
    (item) => item.portfolio.userId === selfUserId,
  );
  const performance = buildPortfolioPerformance(snapshots);
  return (
    <Card className="border-white/10 bg-card">
      <CardHeader>
        <CardTitle>Performance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Metric
            label="Latest NAV"
            value={money(fromCents(performance.latestNavCents))}
          />
          <Metric
            label="Max drawdown"
            value={`${(performance.maxDrawdownBps / 100).toFixed(2)}%`}
          />
          <Metric
            label="Realized P&L"
            value={money(fromCents(performance.latestRealizedCents))}
          />
          <Metric
            label="Unrealized P&L"
            value={money(fromCents(performance.latestUnrealizedCents))}
          />
        </div>
        <PortfolioPerformanceChart points={performance.points} />
      </CardContent>
    </Card>
  );
}

function LiveServerEvents({ events }: { events: FinanceMatchEventView[] }) {
  return (
    <Card className="border-white/10 bg-card">
      <CardHeader>
        <CardTitle>Live server events</CardTitle>
      </CardHeader>
      <CardContent className="max-h-80 space-y-2 overflow-y-auto">
        {events.map((event) => (
          <div
            className="rounded-lg bg-white/[0.03] p-2 text-xs"
            key={event.sequence}
          >
            <span className="text-cyan-300">#{event.sequence}</span>{" "}
            {event.type} {event.detail}
          </div>
        ))}
        {!events.length ? (
          <p className="text-sm text-slate-500">Waiting for server events.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

type PortfolioPerformancePoint = {
  round: number;
  navCents: number;
  realizedCents: number;
  unrealizedCents: number;
};

// 依回合排序 snapshot，並以歷史 NAV 高點計算最大回撤。
function buildPortfolioPerformance(
  snapshots: FinanceHistoryPage["portfolioSnapshots"],
) {
  const points = [...snapshots]
    .sort((left, right) => left.round - right.round)
    .map((snapshot) => ({
      round: snapshot.round,
      navCents: snapshot.portfolio.navCents,
      realizedCents: snapshot.portfolio.realizedPnlCents,
      unrealizedCents: snapshot.portfolio.unrealizedPnlCents,
    }));
  let peak = 0;
  let maxDrawdownBps = 0;
  for (const point of points) {
    peak = Math.max(peak, point.navCents);
    if (peak > 0)
      maxDrawdownBps = Math.max(
        maxDrawdownBps,
        Math.round(((peak - point.navCents) / peak) * 10_000),
      );
  }
  const latest = points.at(-1);
  return {
    points,
    maxDrawdownBps,
    latestNavCents: latest?.navCents ?? 0,
    latestRealizedCents: latest?.realizedCents ?? 0,
    latestUnrealizedCents: latest?.unrealizedCents ?? 0,
  };
}

// 使用 SVG 呈現 NAV、已實現與未實現損益，不引入額外圖表套件。
function PortfolioPerformanceChart({
  points,
}: {
  points: PortfolioPerformancePoint[];
}) {
  if (points.length < 2)
    return (
      <div className="grid h-48 place-items-center rounded-xl border border-white/10 text-sm text-slate-500">
        Performance chart appears after two rounds.
      </div>
    );
  const width = 900;
  const height = 240;
  const values = points.flatMap((point) => [
    point.navCents,
    point.realizedCents,
    point.unrealizedCents,
  ]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const line = (select: (point: PortfolioPerformancePoint) => number) =>
    points
      .map((point, index) => {
        const x = (index / (points.length - 1)) * width;
        const y = height - ((select(point) - min) / range) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-slate-950 p-3">
      <svg
        className="h-60 min-w-[700px] w-full"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        aria-label="NAV, realized and unrealized profit and loss by round"
      >
        <polyline
          fill="none"
          points={line((point) => point.navCents)}
          stroke="#22d3ee"
          strokeWidth="4"
        />
        <polyline
          fill="none"
          points={line((point) => point.realizedCents)}
          stroke="#34d399"
          strokeWidth="3"
        />
        <polyline
          fill="none"
          points={line((point) => point.unrealizedCents)}
          stroke="#fb7185"
          strokeWidth="3"
        />
      </svg>
      <div className="mt-2 flex gap-4 text-xs text-slate-400">
        <span className="text-cyan-300">NAV</span>
        <span className="text-emerald-300">Realized</span>
        <span className="text-rose-300">Unrealized</span>
        <span>
          Rounds {points[0].round}-{points.at(-1)?.round}
        </span>
      </div>
    </div>
  );
}
function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="border-b border-r border-white/10 px-3 py-2.5 last:border-r-0">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[.16em] text-slate-500">
        {icon}
        {label}
      </div>
      <p className="mt-1 truncate text-base font-semibold text-slate-50">
        {value}
      </p>
    </div>
  );
}
function Portfolio({
  title,
  portfolio,
  ready,
}: {
  title: string;
  portfolio?: FinanceMatchStateView["portfolios"][string];
  ready: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex justify-between">
        <h3 className="font-semibold">{title}</h3>
        <Badge variant="outline">{ready ? "ready" : "not ready"}</Badge>
      </div>
      {portfolio ? (
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <Metric label="Cash" value={money(fromCents(portfolio.cashCents))} />
          <Metric label="NAV" value={money(fromCents(portfolio.navCents))} />
          <Metric
            label="BTC"
            value={btc(fromMicros(portfolio.quantityMicros))}
          />
          <Metric
            label="Return"
            value={`${(portfolio.returnBps / 100).toFixed(2)}%`}
          />
          <Metric
            label="Avg. cost"
            value={money(fromCents(portfolio.averageCostCents))}
          />
          <Metric
            label="Unrealized P&L"
            value={money(fromCents(portfolio.unrealizedPnlCents))}
          />
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">No player joined.</p>
      )}
    </div>
  );
}

function OpponentSummary({
  title,
  online,
  ready,
  leadStatus,
}: {
  title: string;
  online: boolean;
  ready: boolean;
  leadStatus: FinanceMatchStateView["opponentLeadStatus"];
}) {
  const leadText =
    leadStatus === "opponent_ahead"
      ? "Opponent ahead"
      : leadStatus === "you_ahead"
        ? "You are ahead"
        : "Too close to call";
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="truncate font-semibold">{title}</h3>
        <Badge variant="outline">{ready ? "confirmed" : "not confirmed"}</Badge>
      </div>
      <div className="mt-4 grid gap-3 text-sm">
        <div className="flex items-center gap-2 text-slate-300">
          {online ? (
            <Wifi className="size-4 text-emerald-300" />
          ) : (
            <WifiOff className="size-4 text-rose-300" />
          )}
          {online ? "Online" : "Disconnected"}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500">
            Duel position
          </p>
          <p className="mt-1 font-medium">{leadText}</p>
        </div>
        <p className="text-xs text-slate-500">
          Opponent portfolio, orders and fills are private during the match.
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
// 將美分轉換為金額。
function fromCents(value: number) {
  return value / 100;
}
// 將 BTC 轉換為微單位，最小為 1 微單位。
function toMicros(value: number) {
  return Math.max(1, Math.round(value * 1_000_000));
}
// 將微單位轉換為 BTC。
function fromMicros(value: number) {
  return value / 1_000_000;
}
// 將 BTC 數值格式化為字串，最多顯示小數點後 6 位。
function btc(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

function signed(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}
// 計算市場指標，包括 SMA、EMA、RSI、MACD、Signal、波動率與趨勢。
// 從 candle close 計算 SMA、EMA、RSI、MACD、波動率與簡化趨勢判定。
function buildIndicators(candles: MatchCandleView[]): MarketIndicators {
  const closes = candles
    .map((item) => item.close)
    .filter((value) => Number.isFinite(value) && value > 0);
  const returns = closes
    .slice(1)
    .map((value, index) => ((value - closes[index]) / closes[index]) * 100);
  const ema12Series = emaSeries(closes, 12);
  const ema26Series = emaSeries(closes, 26);
  const macdSeries = closes.map(
    (_, index) => (ema12Series[index] ?? 0) - (ema26Series[index] ?? 0),
  );
  const signalSeries = emaSeries(macdSeries, 9);
  const sma5 = average(closes.slice(-5));
  const sma20 = closes.length >= 20 ? average(closes.slice(-20)) : null;
  const latestMacd = macdSeries.at(-1) ?? null;
  return {
    sma5,
    sma20,
    ema12: ema12Series.at(-1) ?? null,
    rsi14: rsi(closes, 14),
    macd: closes.length >= 26 ? latestMacd : null,
    signal: closes.length >= 34 ? (signalSeries.at(-1) ?? null) : null,
    volatility: standardDeviation(returns.slice(-20)),
    trend:
      sma5 !== null && sma20 !== null
        ? sma5 > sma20
          ? "bullish"
          : sma5 < sma20
            ? "bearish"
            : "neutral"
        : "neutral",
  };
}
// 計算簡單移動平均 (SMA) 的數值序列，SMA 對所有價格給予相同的權重。
// 計算每一根 candle 對應的簡單移動平均序列。
function movingAverageSeries(values: number[], period: number) {
  return values.map((_, index) =>
    index + 1 < period
      ? null
      : average(values.slice(index + 1 - period, index + 1)),
  );
}
// 計算指數移動平均 (EMA) 的數值序列，EMA 會給予近期價格更高的權重，對價格變化更敏感。
// 以標準平滑係數 2/(period+1) 計算指數移動平均。
function emaSeries(values: number[], period: number) {
  if (!values.length) return [];
  const multiplier = 2 / (period + 1);
  const result = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    result.push(
      values[index] * multiplier + result[index - 1] * (1 - multiplier),
    );
  }
  return result;
}
// Relative Strength Index (RSI) calculation
// 使用最近 period 段漲跌幅計算 RSI；資料不足時不顯示數值。
function rsi(values: number[], period: number) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let index = values.length - period; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}
// Standard deviation calculation
function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
// Standard deviation calculation
function standardDeviation(values: number[]) {
  const mean = average(values);
  if (mean === null || !values.length) return null;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length,
  );
}
// Generate SVG path for a series of values
// 將技術指標序列轉為 SVG path，略過尚無足夠樣本的 null 區段。
function seriesPath(
  series: Array<number | null>,
  x: (index: number) => number,
  y: (value: number) => number,
) {
  let started = false;
  return series
    .map((value, index) => {
      if (value === null) return "";
      const command = started ? "L" : "M";
      started = true;
      return `${command}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
    })
    .join(" ");
}
// Format money value or return "--" if null
function indicatorMoney(value: number | null) {
  return value === null ? "--" : money(value);
}
// 用於顯示指標數值，若為 null 則顯示 "--"。
function indicatorNumber(value: number | null) {
  return value === null ? "--" : value.toFixed(2);
}
// 用於判斷 WebSocket snapshot 是否為 FinanceMatchStateView。
// WebSocket payload 在進入 React state 前先做最小結構檢查。
function isFinanceState(value: unknown): value is FinanceMatchStateView {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "finance_state",
  );
}
// 用於判斷 WebSocket snapshot 是否為 FinanceMatchEventView。
function isFinanceEventEnvelope(
  value: unknown,
): value is { kind: "finance_event"; event: FinanceMatchEventView } {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "finance_event" &&
    (value as { event?: unknown }).event,
  );
}
// 用於描述錯誤訊息，若為 Error 物件則回傳其 message，否則回傳預設訊息。
function describeError(value: unknown) {
  if (value instanceof Error && value.message) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const candidate = value as {
      message?: unknown;
      error?: unknown;
      code?: unknown;
    };
    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return candidate.message;
    }
    if (typeof candidate.error === "string" && candidate.error.trim()) {
      return candidate.error;
    }
    if (candidate.code !== undefined) {
      return `Request failed (code ${String(candidate.code)}).`;
    }
  }
  return "Finance match operation failed.";
}
