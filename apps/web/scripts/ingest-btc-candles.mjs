import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ccxt from "ccxt";
import { Client } from "@heroiclabs/nakama-js";

// 一次性匯入腳本：把最近一批 BTC candles 寫進 runtime storage，適合手動 bootstrap。
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
const limit = Number(process.env.MATCH_PRICE_LIMIT ?? "60");

const Exchange = ccxt[exchangeId];
if (!Exchange) {
  throw new Error(`Unsupported ccxt exchange: ${exchangeId}`);
}

const exchange = new Exchange({ enableRateLimit: true });
const client = new Client(serverKey, host, port, useSSL);

function toPrice(value) {
  return Math.round(Number(value));
}

// 這是手動 bootstrap 路徑；若要持續更新行情，應改用會重複輪詢的 worker 版本。
async function main() {
  const user = `price-feed-${randomUUID().slice(0, 8)}`;
  const session = await client.authenticateDevice(`price-feed-${randomUUID()}`, true, user);
  const rows = await exchange.fetchOHLCV(symbol, timeframe, undefined, Number.isFinite(limit) ? limit : 60);
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

  const signedPayload = {
    sentAt: new Date().toISOString(),
    nonce: randomUUID(),
    symbol,
    source: `${exchangeId}:${timeframe}`,
    candles,
  };
  signedPayload.signature = signIngestPayload(ingestSecret, signedPayload);
  const response = await client.rpc(session, ingestRpcId, signedPayload);
  const parsed = typeof response.payload === "string" ? JSON.parse(response.payload) : response.payload;
  console.log(JSON.stringify(parsed, null, 2));
}

main().catch((error) => {
  console.error("BTC candle ingestion failed.");
  console.error(error);
  process.exitCode = 1;
});
