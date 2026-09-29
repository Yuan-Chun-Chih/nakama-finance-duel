import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@heroiclabs/nakama-js";

function loadEnv(filename) {
  const path = resolve(process.cwd(), filename);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv(".env.local");
const host = process.env.NEXT_PUBLIC_NAKAMA_HOST ?? "127.0.0.1";
const port = process.env.NEXT_PUBLIC_NAKAMA_PORT ?? "7350";
const serverKey =
  process.env.NEXT_PUBLIC_NAKAMA_SERVER_KEY ?? "nakama-finance-dev-key";
const useSSL = process.env.NEXT_PUBLIC_NAKAMA_USE_SSL === "true";
const client = new Client(serverKey, host, port, useSSL);
const listFinanceHistoryRpc =
  process.env.NEXT_PUBLIC_NAKAMA_LIST_FINANCE_HISTORY_RPC_ID ??
  "list_finance_history";
const financeMatchmakingRpc =
  process.env.NEXT_PUBLIC_NAKAMA_FINANCE_MATCHMAKING_RPC_ID ??
  "finance_matchmaking";
const OP = {
  ready: 220,
  order: 221,
  stateRequest: 223,
  state: 224,
  resign: 226,
  matchCancel: 227,
};

function identity(prefix) {
  const suffix = randomUUID().slice(0, 8);
  return {
    username: `${prefix}-${suffix}`,
    email: `${prefix}-${suffix}@example.test`,
    password: `Pass-${suffix}-2026`,
  };
}

function parseRpc(response) {
  return typeof response?.payload === "string"
    ? JSON.parse(response.payload)
    : (response?.payload ?? {});
}

function decode(data) {
  return JSON.parse(new TextDecoder().decode(data));
}

function waitForState(socket, predicate, timeoutMs = 20_000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(
      () => rejectPromise(new Error("Timed out waiting for finance state.")),
      timeoutMs,
    );
    socket.onmatchdata = (event) => {
      if (event.op_code !== OP.state) return;
      const state = decode(event.data);
      if (!predicate(state)) return;
      clearTimeout(timeout);
      resolvePromise(state);
    };
  });
}

function waitForMatchmaker(socket, timeoutMs = 25_000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(
      () =>
        rejectPromise(new Error("Timed out waiting for finance matchmaker.")),
      timeoutMs,
    );
    socket.onmatchmakermatched = (matched) => {
      clearTimeout(timeout);
      resolvePromise(matched);
    };
  });
}

async function main() {
  const identityA = identity("finance-a");
  const identityB = identity("finance-b");
  const sessionA = await client.authenticateEmail(
    identityA.email,
    identityA.password,
    true,
    identityA.username,
  );
  const sessionB = await client.authenticateEmail(
    identityB.email,
    identityB.password,
    true,
    identityB.username,
  );
  const userA = (await client.getAccount(sessionA)).user?.id;
  const userB = (await client.getAccount(sessionB)).user?.id;
  assert.ok(userA && userB);

  let socketA = client.createSocket(useSSL, false);
  const socketB = client.createSocket(useSSL, false);
  await socketA.connect(sessionA, true);
  await socketB.connect(sessionB, true);
  const matchedA = waitForMatchmaker(socketA);
  const matchedB = waitForMatchmaker(socketB);
  const queueA = parseRpc(
    await client.rpc(sessionA, financeMatchmakingRpc, { action: "begin" }),
  ).matchmaking;
  const queueB = parseRpc(
    await client.rpc(sessionB, financeMatchmakingRpc, { action: "begin" }),
  ).matchmaking;
  await socketA.addMatchmaker("+properties.gameType:finance", 2, 2, {
    gameType: "finance",
    queueToken: queueA.queueToken,
  });
  await socketB.addMatchmaker("+properties.gameType:finance", 2, 2, {
    gameType: "finance",
    queueToken: queueB.queueToken,
  });
  const [matchA, matchB] = await Promise.all([matchedA, matchedB]);
  assert.equal(matchA.match_id, matchB.match_id);
  const matchId = matchA.match_id;
  const joinedA = await socketA.joinMatch(matchId, matchA.token);
  await socketB.joinMatch(matchId, matchB.token);
  assert.equal(joinedA.authoritative, true);

  const confirmation = waitForState(
    socketA,
    (state) =>
      state.status === "matched_confirming" && state.countdownSeconds > 0,
  );
  await socketA.sendMatchState(
    matchId,
    OP.ready,
    JSON.stringify({ kind: "finance_ready", ready: true }),
  );
  await socketB.sendMatchState(
    matchId,
    OP.ready,
    JSON.stringify({ kind: "finance_ready", ready: true }),
  );
  const confirmationState = await confirmation;
  assert.ok(
    confirmationState.countdownSeconds <= 30,
    "matched players must receive a 30-second server confirmation deadline",
  );
  const countdown = await waitForState(
    socketA,
    (state) => state.status === "countdown" && state.countdownSeconds > 0,
    5_000,
  );
  assert.ok(
    countdown.countdownSeconds <= 3,
    "both confirmations must start a separate 3-second countdown",
  );
  const start = await waitForState(
    socketA,
    (state) => state.status === "running" && state.players.length === 2,
    15_000,
  );
  assert.equal(start.round, 1);
  assert.equal(start.remainingSeconds, 300);
  assert.ok(start.priceCents > 0);
  assert.equal(
    start.marketStale,
    false,
    "fresh server price must allow trading",
  );

  socketA.disconnect(false);
  socketA = client.createSocket(useSSL, false);
  await socketA.connect(sessionA, true);
  await socketA.joinMatch(matchId);
  const resumed = waitForState(
    socketA,
    (state) =>
      state.status === "running" && state.stateVersion > start.stateVersion,
  );
  await socketA.sendMatchState(
    matchId,
    OP.stateRequest,
    JSON.stringify({ kind: "finance_state_request" }),
  );
  const resumedState = await resumed;
  assert.ok(
    resumedState.portfolios?.[userA],
    "reconnected player must receive their latest portfolio snapshot",
  );

  const bought = waitForState(
    socketA,
    (state) => state.portfolios?.[userA]?.quantityMicros === 250_000,
  );
  await socketA.sendMatchState(
    matchId,
    OP.order,
    JSON.stringify({
      kind: "finance_order",
      side: "buy",
      orderType: "market",
      quantityMicros: 250_000,
      limitPriceCents: 0,
      clientOrderId: "smoke-buy-1",
    }),
  );
  await socketA.sendMatchState(
    matchId,
    OP.order,
    JSON.stringify({
      kind: "finance_order",
      side: "buy",
      orderType: "market",
      quantityMicros: 250_000,
      limitPriceCents: 0,
      clientOrderId: "smoke-buy-1",
    }),
  );
  const afterBuy = await bought;
  assert.ok(
    afterBuy.portfolios[userA].cashCents < 100_000_000,
    "server must debit cash after a market buy",
  );
  assert.ok(
    afterBuy.portfolios[userA].navCents <= 100_000_000,
    "fees and slippage must be reflected in NAV",
  );
  const privateState = waitForState(
    socketB,
    (state) => state.status === "running",
  );
  await socketB.sendMatchState(
    matchId,
    OP.stateRequest,
    JSON.stringify({ kind: "finance_state_request" }),
  );
  assert.equal(
    (await privateState).portfolios?.[userA],
    undefined,
    "opponent portfolio must not be exposed in realtime snapshots",
  );

  const sold = waitForState(
    socketA,
    (state) => state.portfolios?.[userA]?.quantityMicros === 100_000,
  );
  await socketA.sendMatchState(
    matchId,
    OP.order,
    JSON.stringify({
      kind: "finance_order",
      side: "sell",
      orderType: "market",
      quantityMicros: 150_000,
      limitPriceCents: 0,
      clientOrderId: "smoke-sell-1",
    }),
  );
  const afterSell = await sold;

  const tinyFill = waitForState(
    socketA,
    (state) => state.portfolios?.[userA]?.quantityMicros === 100_001,
  );
  await socketA.sendMatchState(
    matchId,
    OP.order,
    JSON.stringify({
      kind: "finance_order",
      side: "buy",
      orderType: "market",
      quantityMicros: 1,
      limitPriceCents: 0,
      clientOrderId: "smoke-buy-2",
    }),
  );
  const afterTinyFill = await tinyFill;
  assert.ok(
    afterTinyFill.portfolios[userA].cashCents <
      afterSell.portfolios[userA].cashCents,
    "one BTC micro must still debit USD cents instead of creating a free position",
  );

  const finished = waitForState(
    socketA,
    (state) => state.status === "finished" && state.finishReason === "resign",
  );
  await socketB.sendMatchState(
    matchId,
    OP.resign,
    JSON.stringify({ kind: "finance_resign" }),
  );
  const result = await finished;
  assert.deepEqual(
    result.winnerUserIds,
    [userA],
    "resigning player must lose by authoritative decision",
  );

  const history = parseRpc(
    await client.rpc(sessionA, listFinanceHistoryRpc, {
      arenaId: result.arenaId,
      limit: 10,
    }),
  );
  assert.equal(
    history.orders?.length,
    3,
    "history RPC must contain each idempotent order exactly once",
  );
  assert.equal(
    history.fills?.length,
    3,
    "history RPC must contain each authoritative fill exactly once",
  );
  assert.ok(
    history.portfolioSnapshots?.some(
      (item) => item.round === 1 && item.portfolio.userId === userA,
    ),
    "round portfolio snapshots must be persisted",
  );
  assert.equal(
    history.stats?.games,
    1,
    "finance stats projection must count the completed game",
  );
  assert.equal(
    history.stats?.wins,
    1,
    "authoritative winner must receive a finance win",
  );
  assert.equal(
    history.stats?.rating,
    1016,
    "first finance win must apply the Elo rating change",
  );
  assert.ok(
    history.games?.some((game) => game.arenaId === result.arenaId),
    "player history must include the completed finance game",
  );

  const identityC = identity("finance-cancel-a");
  const identityD = identity("finance-cancel-b");
  const sessionC = await client.authenticateEmail(
    identityC.email,
    identityC.password,
    true,
    identityC.username,
  );
  const sessionD = await client.authenticateEmail(
    identityD.email,
    identityD.password,
    true,
    identityD.username,
  );
  const userC = (await client.getAccount(sessionC)).user?.id;
  const userD = (await client.getAccount(sessionD)).user?.id;
  assert.ok(userC && userD);
  const socketC = client.createSocket(useSSL, false);
  const socketD = client.createSocket(useSSL, false);
  await socketC.connect(sessionC, true);
  await socketD.connect(sessionD, true);
  const rematchC = waitForMatchmaker(socketC);
  const rematchD = waitForMatchmaker(socketD);
  const requeueC = parseRpc(
    await client.rpc(sessionC, financeMatchmakingRpc, { action: "begin" }),
  ).matchmaking;
  const requeueD = parseRpc(
    await client.rpc(sessionD, financeMatchmakingRpc, { action: "begin" }),
  ).matchmaking;
  await socketC.addMatchmaker("+properties.gameType:finance", 2, 2, {
    gameType: "finance",
    queueToken: requeueC.queueToken,
  });
  await socketD.addMatchmaker("+properties.gameType:finance", 2, 2, {
    gameType: "finance",
    queueToken: requeueD.queueToken,
  });
  const [cancelMatchC, cancelMatchD] = await Promise.all([rematchC, rematchD]);
  const cancelMatchId = cancelMatchC.match_id;
  await socketC.joinMatch(cancelMatchId, cancelMatchC.token);
  await socketD.joinMatch(cancelMatchId, cancelMatchD.token);
  const canceledState = waitForState(
    socketC,
    (state) => state.status === "canceled" && state.canceledByUserId === userD,
  );
  await socketD.sendMatchState(
    cancelMatchId,
    OP.matchCancel,
    JSON.stringify({ kind: "finance_match_cancel" }),
  );
  await canceledState;
  const statusC = parseRpc(
    await client.rpc(sessionC, financeMatchmakingRpc, { action: "status" }),
  ).matchmaking;
  const statusD = parseRpc(
    await client.rpc(sessionD, financeMatchmakingRpc, { action: "status" }),
  ).matchmaking;
  assert.equal(
    statusC.status,
    "searching",
    "remaining player must return to authoritative searching state",
  );
  assert.equal(
    statusD.status,
    "cooldown",
    "canceling player must enter cooldown",
  );
  await client
    .rpc(sessionC, financeMatchmakingRpc, { action: "begin" })
    .catch(() => undefined);
  const duplicateStatus = parseRpc(
    await client.rpc(sessionC, financeMatchmakingRpc, { action: "status" }),
  ).matchmaking;
  assert.equal(
    duplicateStatus.queueToken,
    statusC.queueToken,
    "duplicate queue request must not replace the active queue token",
  );
  await client.rpc(sessionC, financeMatchmakingRpc, { action: "cancel" });
  await socketC.leaveMatch(cancelMatchId).catch(() => {});
  await socketD.leaveMatch(cancelMatchId).catch(() => {});
  socketC.disconnect(false);
  socketD.disconnect(false);

  socketA.disconnect(false);
  socketB.disconnect(false);
  console.log("Authoritative finance duel smoke test passed.");
  console.log(
    JSON.stringify(
      { matchId, arenaId: result.arenaId, winnerUserId: userA },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("Authoritative finance duel smoke test failed.");
  console.error(error);
  process.exit(1);
});
