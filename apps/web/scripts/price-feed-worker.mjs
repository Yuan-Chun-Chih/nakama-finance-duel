import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ccxt from "ccxt";
import { Client } from "@heroiclabs/nakama-js";

// 長駐行情 worker：持續輪詢 ccxt，並把 candles 推進 Nakama runtime storage。
function signIngestPayload(secret, payload) {
  const candleLines = payload.candles.map((candle) =>
    [candle.round, candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume].join(","),
  );
  const canonical = [payload.sentAt, payload.nonce, payload.symbol.toUpperCase(), payload.source, ...candleLines].join("\n");
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

function loadEnvFile(filename) {
  const fullPath = resolve(process.cwd(), filename);
  if (!existsSync(fullPath)) return;

  for (const line of readFileSync(fullPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const host = process.env.NEXT_PUBLIC_NAKAMA_HOST ?? "127.0.0.1";
const port = process.env.NEXT_PUBLIC_NAKAMA_PORT ?? "7350";
const serverKey = process.env.NEXT_PUBLIC_NAKAMA_SERVER_KEY ?? "nakama-finance-dev-key";
const useSSL = process.env.NEXT_PUBLIC_NAKAMA_USE_SSL === "true";
const ingestRpcId = process.env.NAKAMA_INGEST_MATCH_CANDLES_RPC_ID ?? "ingest_match_candles";
const ingestSecret = requireEnv("MATCH_PRICE_INGEST_SECRET");
const exchangeId = process.env.MATCH_PRICE_EXCHANGE ?? "binance";
const symbol = process.env.MATCH_PRICE_SYMBOL ?? "BTC/USDT";
const timeframe = process.env.MATCH_PRICE_TIMEFRAME ?? "1m";
const limit = Number(process.env.MATCH_PRICE_LIMIT ?? "120");
const pollIntervalMs = Math.max(10_000, Number(process.env.MATCH_PRICE_POLL_INTERVAL_MS ?? "60000"));
const maxBackoffMs = Math.max(pollIntervalMs, Number(process.env.MATCH_PRICE_MAX_BACKOFF_MS ?? "300000"));
const alertAfterFailures = Math.max(1, Number(process.env.MATCH_PRICE_ALERT_AFTER_FAILURES ?? "3"));
const alertWebhookUrl = process.env.MATCH_PRICE_ALERT_WEBHOOK_URL?.trim() ?? "";

const Exchange = ccxt[exchangeId];
if (!Exchange) {
  throw new Error(`Unsupported ccxt exchange: ${exchangeId}`);
}

const exchange = new Exchange({ enableRateLimit: true });
const client = new Client(serverKey, host, port, useSSL);
const deviceId = `price-feed-worker-${randomUUID()}`;
let session = null;
let stopped = false;
let consecutiveFailures = 0;
let lastSuccessAt = null;

process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});

function toPrice(value) {
  return Math.round(Number(value));
}

class PriceFeedError extends Error {
  constructor(category, message, cause) {
    super(message, { cause });
    this.name = "PriceFeedError";
    this.category = category;
  }
}

function classifyExchangeError(error) {
  if (error instanceof ccxt.NetworkError) return "exchange_network";
  if (error instanceof ccxt.ExchangeError) return "exchange_rejected";
  return "exchange_unknown";
}

function logEvent(level, event, details = {}) {
  const output = { timestamp: new Date().toISOString(), level, event, ...details };
  const serialized = JSON.stringify(output);
  if (level === "error") console.error(serialized);
  else if (level === "warn") console.warn(serialized);
  else console.log(serialized);
}

async function sendAlert(error, retryInMs) {
  const alert = {
    worker: "match-price-feed",
    category: error.category ?? "unknown",
    message: error.message,
    consecutiveFailures,
    retryInMs,
    lastSuccessAt,
  };
  logEvent("error", "price_feed_alert", alert);
  if (!alertWebhookUrl) return;
  try {
    const response = await fetch(alertWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(alert),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Alert webhook returned HTTP ${response.status}`);
  } catch (webhookError) {
    logEvent("error", "price_feed_alert_delivery_failed", { message: webhookError instanceof Error ? webhookError.message : String(webhookError) });
  }
}

// 在多次輪詢之間重用 device session，讓這支 worker 表現得像長駐的行情匯入服務。
async function getSession() {
  if (session && !session.isexpired(Date.now() / 1000 + 300)) {
    return session;
  }
  session = await client.authenticateDevice(deviceId, true, `price-feed-${randomUUID().slice(0, 8)}`);
  return session;
}

// 抓取一批 OHLCV，並透過受保護的 ingest RPC 寫進後端 storage。
async function ingestOnce() {
  let activeSession;
  try {
    activeSession = await getSession();
  } catch (error) {
    session = null;
    throw new PriceFeedError("nakama_authentication", "Could not authenticate the price-feed worker with Nakama.", error);
  }
  let rows;
  try {
    rows = await exchange.fetchOHLCV(symbol, timeframe, undefined, Number.isFinite(limit) ? limit : 120);
  } catch (error) {
    throw new PriceFeedError(classifyExchangeError(error), "Could not fetch OHLCV from exchange.", error);
  }
  const candles = rows.map(([timestamp, open, high, low, close, volume], index) => ({
    symbol,
    round: index + 1,
    open: toPrice(open),
    high: toPrice(high),
    low: toPrice(low),
    close: toPrice(close),
    volume: Math.round(Number(volume) || 0),
    timestamp,
  }));

  let response;
  try {
    const signedPayload = {
      sentAt: new Date().toISOString(),
      nonce: randomUUID(),
      symbol,
      source: `${exchangeId}:${timeframe}`,
      candles,
    };
    signedPayload.signature = signIngestPayload(ingestSecret, signedPayload);
    response = await client.rpc(activeSession, ingestRpcId, signedPayload);
  } catch (error) {
    session = null;
    throw new PriceFeedError("nakama_ingestion", "Exchange data was fetched but Nakama ingestion failed.", error);
  }
  return typeof response.payload === "string" ? JSON.parse(response.payload) : response.payload;
}

// 持續輪詢直到收到 SIGINT/SIGTERM，因此可當成輕量本地排程服務使用。
async function main() {
  console.log(
    JSON.stringify(
      {
        worker: "match-price-feed",
        exchange: exchangeId,
        symbol,
        timeframe,
        limit,
        pollIntervalMs,
      },
      null,
      2,
    ),
  );

  while (!stopped) {
    try {
      const result = await ingestOnce();
      consecutiveFailures = 0;
      lastSuccessAt = new Date().toISOString();
      logEvent("info", "price_feed_ingested", { result, lastSuccessAt, nextPollInMs: pollIntervalMs });
      await new Promise((resolveSleep) => setTimeout(resolveSleep, pollIntervalMs));
    } catch (error) {
      consecutiveFailures++;
      const normalized = error instanceof PriceFeedError ? error : new PriceFeedError("worker_internal", error instanceof Error ? error.message : String(error), error);
      const retryInMs = Math.min(maxBackoffMs, pollIntervalMs * (2 ** Math.min(consecutiveFailures - 1, 8)));
      logEvent("warn", "price_feed_retry_scheduled", {
        category: normalized.category,
        message: normalized.message,
        consecutiveFailures,
        retryInMs,
        lastSuccessAt,
      });
      if (consecutiveFailures >= alertAfterFailures) await sendAlert(normalized, retryInMs);
      await new Promise((resolveSleep) => setTimeout(resolveSleep, retryInMs));
    }
  }
}

main().catch((error) => {
  console.error("Price feed worker failed.");
  console.error(error);
  process.exitCode = 1;
});
