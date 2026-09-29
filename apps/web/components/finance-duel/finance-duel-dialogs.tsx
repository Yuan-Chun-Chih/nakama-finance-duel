"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type MatchConfirmationDialogProps = {
  busy: boolean;
  countdown: number;
  opponentName: string;
  opponentReady: boolean;
  selfReady: boolean;
  onCancel: () => Promise<void>;
  onConfirm: () => Promise<void>;
};

// 配對確認只能透過明確按鈕結束，避免點擊遮罩時意外取消配對。
export function MatchConfirmationDialog({
  busy,
  countdown,
  opponentName,
  opponentReady,
  selfReady,
  onCancel,
  onConfirm,
}: MatchConfirmationDialogProps) {
  return (
    <Dialog open>
      <DialogContent
        className="max-w-sm border-cyan-300/25 bg-popover shadow-2xl"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="text-center">
          <p className="text-xs uppercase tracking-[.28em] text-cyan-300">
            Opponent found
          </p>
          <DialogTitle className="text-2xl">Confirm this duel</DialogTitle>
          <DialogDescription>
            Both players must confirm before the opening countdown begins.
          </DialogDescription>
        </DialogHeader>
        <div className="text-center" aria-live="polite" aria-atomic="true">
          <p className="text-6xl font-black tabular-nums text-foreground">
            {countdown}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            seconds remaining
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center text-sm">
          <ConfirmationState label="You" ready={selfReady} />
          <ConfirmationState label={opponentName} ready={opponentReady} />
        </div>
        <DialogFooter className="grid grid-cols-2 sm:grid-cols-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void onCancel()}
          >
            Cancel
          </Button>
          <Button
            disabled={busy || selfReady}
            onClick={() => void onConfirm()}
          >
            {selfReady ? "Confirmed" : "Confirm match"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmationState({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-border p-3">
      <p className="truncate text-muted-foreground">{label}</p>
      <p className={ready ? "mt-1 text-emerald-300" : "mt-1 text-amber-300"}>
        {ready ? "Confirmed" : "Waiting"}
      </p>
    </div>
  );
}

// 開局倒數由 server snapshot 驅動，aria-live 讓輔助工具同步讀出秒數。
export function GameStartCountdownDialog({ seconds }: { seconds: number }) {
  return (
    <Dialog open>
      <DialogContent
        className="max-w-xs border-cyan-300/25 bg-popover px-10 py-8 text-center shadow-2xl"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="items-center">
          <p className="text-xs uppercase tracking-[.28em] text-cyan-300">
            Match confirmed
          </p>
          <DialogTitle className="sr-only">Trading starts shortly</DialogTitle>
        </DialogHeader>
        <div aria-live="assertive" aria-atomic="true">
          <p className="text-7xl font-black tabular-nums text-foreground">
            {seconds}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Trading starts shortly
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ActionConfirmDialogProps = {
  action: "resign" | "leave";
  running: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

// 投降與離場共用可鍵盤操作的確認對話框，避免手機上誤觸立即執行。
export function ActionConfirmDialog({
  action,
  running,
  busy,
  onCancel,
  onConfirm,
}: ActionConfirmDialogProps) {
  const resigning = action === "resign";
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent
        className="max-w-md border-rose-300/25 bg-popover shadow-2xl"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <p className="text-xs uppercase tracking-[.28em] text-rose-300">
            {resigning ? "Forfeit confirmation" : "Leave confirmation"}
          </p>
          <DialogTitle className="text-2xl">
            {resigning ? "Resign this duel?" : "Leave this arena?"}
          </DialogTitle>
          <DialogDescription className="leading-6">
            {resigning
              ? "The server will record a resign and award the win to your opponent."
              : running
                ? "Leaving during a running duel starts the reconnect grace period. If you do not return in time, the server records a disconnect forfeit."
                : "You will leave the current room and return to the matchmaking screen."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="grid grid-cols-2 sm:grid-cols-2">
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Keep playing
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {resigning ? "Resign" : "Leave match"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
