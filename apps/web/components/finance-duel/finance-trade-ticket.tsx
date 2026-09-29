"use client";

import { useEffect, useEffectEvent } from "react";
import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type FinanceTradeTicketProps = {
  mobileOpen: boolean;
  side: "buy" | "sell";
  quantity: number;
  effectiveQuantity: number;
  maxQuantity: number;
  availableCash: number;
  marketAgeSeconds: number | null;
  estimatedNotional: number;
  estimatedFee: number;
  estimatedTax: number;
  disabledReason: string | null;
  submitting: boolean;
  onClose: () => void;
  onQuantityChange: (quantity: number) => void;
  onSideChange: (side: "buy" | "sell") => void;
  onSubmit: () => Promise<void>;
};

// 交易票券只收集下單意圖，價格、資金限制與成交結果仍以 server snapshot 為準。
export function FinanceTradeTicket({
  mobileOpen,
  side,
  quantity,
  effectiveQuantity,
  maxQuantity,
  availableCash,
  marketAgeSeconds,
  estimatedNotional,
  estimatedFee,
  estimatedTax,
  disabledReason,
  submitting,
  onClose,
  onQuantityChange,
  onSideChange,
  onSubmit,
}: FinanceTradeTicketProps) {
  const handleClose = useEffectEvent(onClose);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileOpen]);

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-sm md:hidden"
          aria-label="Close trade ticket"
          onClick={onClose}
        />
      ) : null}
      <Card
        className={`${mobileOpen ? "fixed inset-x-0 bottom-0 block max-h-[calc(100dvh-4rem)] overflow-y-auto rounded-b-none shadow-2xl" : "hidden md:block"} order-1 z-40 border-cyan-300/15 bg-card pb-[env(safe-area-inset-bottom)] md:static md:max-h-none md:overflow-visible md:rounded-xl md:pb-0 md:shadow-none`}
        aria-label="BTC market order ticket"
        role={mobileOpen ? "dialog" : undefined}
        aria-modal={mobileOpen || undefined}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Trade BTC</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline">spot · market</Badge>
              <Button
                className="md:hidden"
                size="icon"
                variant="ghost"
                aria-label="Close trade ticket"
                onClick={onClose}
              >
                <X className="size-5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-black/20 p-1">
            {(["buy", "sell"] as const).map((nextSide) => (
              <Button
                key={nextSide}
                className={
                  side === nextSide
                    ? nextSide === "buy"
                      ? "min-h-11 bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                      : "min-h-11 bg-rose-500 text-white hover:bg-rose-400"
                    : "min-h-11"
                }
                variant={side === nextSide ? "default" : "ghost"}
                aria-pressed={side === nextSide}
                onClick={() => onSideChange(nextSide)}
              >
                {nextSide === "buy" ? "Buy" : "Sell"}
              </Button>
            ))}
          </div>
          <label className="block space-y-2 text-sm" htmlFor="btc-quantity">
            <span className="flex items-center justify-between gap-3">
              <span>Quantity</span>
              <span className="tabular-nums text-muted-foreground">
                {formatBTC(effectiveQuantity)} BTC
              </span>
            </span>
            <Input
              id="btc-quantity"
              className="h-11 font-mono tabular-nums"
              type="number"
              inputMode="decimal"
              min={0.000001}
              max={Math.max(0.000001, maxQuantity)}
              step={0.000001}
              value={quantity}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) onQuantityChange(Math.max(0, next));
              }}
              onBlur={() => onQuantityChange(floorBTC(effectiveQuantity))}
              aria-describedby="btc-quantity-help"
            />
            <input
              className="h-8 w-full accent-cyan-300"
              type="range"
              aria-label="BTC quantity slider"
              min={0.000001}
              max={Math.max(0.000001, maxQuantity)}
              step={0.000001}
              value={effectiveQuantity}
              onChange={(event) => onQuantityChange(Number(event.target.value))}
            />
          </label>
          <div className="grid grid-cols-4 gap-2">
            {[0.25, 0.5, 0.75, 1].map((ratio) => (
              <Button
                key={ratio}
                className="min-h-11"
                variant="outline"
                onClick={() =>
                  onQuantityChange(
                    Math.max(0.000001, floorBTC(maxQuantity * ratio)),
                  )
                }
              >
                {ratio * 100}%
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
            <TradeMetric label="Available cash" value={formatMoney(availableCash)} />
            <TradeMetric label="Available BTC" value={formatBTC(maxQuantity)} />
            <TradeMetric
              label="Price age"
              value={marketAgeSeconds === null ? "--" : `${marketAgeSeconds}s`}
            />
          </div>
          <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
            <div className="flex justify-between gap-3 text-muted-foreground">
              <span>Estimated notional</span>
              <strong className="tabular-nums text-foreground">
                {formatMoney(estimatedNotional)}
              </strong>
            </div>
            <div className="flex justify-between gap-3 text-muted-foreground">
              <span>Fee / tax</span>
              <span className="tabular-nums">
                {formatMoney(estimatedFee)} / {formatMoney(estimatedTax)}
              </span>
            </div>
          </div>
          <div className="sticky bottom-0 -mx-6 space-y-2 border-t border-white/10 bg-card/95 px-6 pb-2 pt-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
            <Button
              className={`min-h-12 w-full font-semibold ${side === "buy" ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400" : "bg-rose-500 text-white hover:bg-rose-400"}`}
              disabled={Boolean(disabledReason)}
              onClick={() => void onSubmit()}
            >
              {submitting
                ? "Submitting..."
                : side === "buy"
                  ? "Market buy BTC"
                  : "Market sell BTC"}
            </Button>
            <p
              id="btc-quantity-help"
              className={`text-center text-xs ${disabledReason ? "text-amber-200" : "text-muted-foreground"}`}
              aria-live="polite"
            >
              {disabledReason ??
                "Orders execute at the current authoritative BTC price."}
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function TradeMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

function floorBTC(value: number) {
  return Math.floor(Math.max(0, value) * 1_000_000) / 1_000_000;
}

function formatBTC(value: number) {
  return floorBTC(value).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}
