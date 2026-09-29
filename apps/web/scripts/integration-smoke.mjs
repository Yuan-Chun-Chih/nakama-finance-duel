import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@heroiclabs/nakama-js";

// 跨功能 smoke test：驗證登入、好友、公會治理、送分、排行榜與 guild chat 是否都能協同運作。
function loadEnvFile(filename) {
  const fullPath = resolve(process.cwd(), filename);
  if (!existsSync(fullPath)) return;

  const raw = readFileSync(fullPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const host = process.env.NEXT_PUBLIC_NAKAMA_HOST ?? "127.0.0.1";
const port = process.env.NEXT_PUBLIC_NAKAMA_PORT ?? "7350";
const serverKey = process.env.NEXT_PUBLIC_NAKAMA_SERVER_KEY ?? "nakama-finance-dev-key";
const useSSL = process.env.NEXT_PUBLIC_NAKAMA_USE_SSL === "true";

const client = new Client(serverKey, host, port, useSSL);

const createGuildRpcId = process.env.NEXT_PUBLIC_NAKAMA_CREATE_GUILD_RPC_ID ?? "create_guild";
const requestGuildJoinRpcId = process.env.NEXT_PUBLIC_NAKAMA_REQUEST_GUILD_JOIN_RPC_ID ?? "request_guild_join";
const approveGuildJoinRpcId = process.env.NEXT_PUBLIC_NAKAMA_APPROVE_GUILD_JOIN_RPC_ID ?? "approve_guild_join";
const scoreRpcId = process.env.NEXT_PUBLIC_NAKAMA_SCORE_RPC_ID ?? "submit_portfolio_score";

function buildCommunityChatTarget(kind, id) {
  return `community:${kind}:${id}`;
}

function uniqueIdentity(prefix) {
  const suffix = randomUUID().slice(0, 8);
  return {
    username: `${prefix}-${suffix}`,
    email: `${prefix}-${suffix}@example.test`,
    password: `Pass-${suffix}-2026`,
  };
}

function parseRpc(response) {
  if (!response?.payload) return {};
  if (typeof response.payload === "string") {
    return JSON.parse(response.payload);
  }
  return response.payload;
}

// 在 guild membership 建立後，驗證聊天訊息能否在兩個獨立 session 之間正常傳遞。
async function waitForMessage(socket, timeoutMs = 10000) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      rejectPromise(new Error("Timed out waiting for chat message."));
    }, timeoutMs);

    socket.onchannelmessage = (message) => {
      clearTimeout(timeout);
      resolvePromise(message);
    };
  });
}

async function main() {
  const userA = uniqueIdentity("smoke-a");
  const userB = uniqueIdentity("smoke-b");

  const sessionA = await client.authenticateEmail(userA.email, userA.password, true, userA.username);
  const sessionB = await client.authenticateEmail(userB.email, userB.password, true, userB.username);

  const accountA = await client.getAccount(sessionA);
  const accountB = await client.getAccount(sessionB);
  const userAId = accountA.user?.id;
  const userBId = accountB.user?.id;

  assert.ok(userAId, "user A id should exist");
  assert.ok(userBId, "user B id should exist");

  await client.addFriends(sessionA, undefined, [userB.username]);
  await client.addFriends(sessionB, [userAId]);

  const friendsA = await client.listFriends(sessionA, undefined, 20);
  assert.ok(
    (friendsA.friends ?? []).some((entry) => entry.user?.id === userBId),
    "friend relationship should exist after acceptance",
  );

  const guildName = `Smoke Guild ${randomUUID().slice(0, 4)}`;
  const createdGroup = await client.createGroup(sessionA, {
    name: guildName,
    description: "Integration smoke test guild",
    lang_tag: "guild",
    max_count: 100,
    open: false,
  });

  // 先完成 guild 建立與審核流程，確保後續 match / community 功能有正確的治理上下文。
  const createGuildResponse = await client.rpc(sessionA, createGuildRpcId, {
    guildId: createdGroup.id,
    name: guildName,
    description: "Integration smoke test guild",
  });
  const guildId = parseRpc(createGuildResponse).guildId;
  assert.ok(guildId, "guild id should be returned");
  assert.equal(guildId, createdGroup.id, "guild id should match the Nakama group id");

  await client.rpc(sessionB, requestGuildJoinRpcId, { guildId });
  await client.rpc(sessionA, approveGuildJoinRpcId, { guildId, userId: userBId });

  const groupUsers = await client.listGroupUsers(sessionA, guildId, undefined, 20);
  assert.ok(
    (groupUsers.group_users ?? []).some((entry) => entry.user?.id === userAId),
    "guild owner should be present in the Nakama group roster",
  );
  assert.ok(
    (groupUsers.group_users ?? []).some((entry) => entry.user?.id === userBId),
    "approved member should be present in the Nakama group roster before chat join",
  );

  await assert.rejects(
    client.rpc(sessionA, scoreRpcId, { score: 125000, source: "smoke-test" }),
    "authenticated clients must not be able to submit authoritative leaderboard scores",
  );

  const socketA = client.createSocket(useSSL, false);
  const socketB = client.createSocket(useSSL, false);
  await socketA.connect(sessionA, true);
  await socketB.connect(sessionB, true);

  const guildChatTarget = buildCommunityChatTarget("guild", guildId);
  const channelA = await socketA.joinChat(guildChatTarget, 1, true, false);
  await socketB.joinChat(guildChatTarget, 1, true, false);

  const messagePromise = waitForMessage(socketB);
  await socketA.writeChatMessage(channelA.id, { body: "integration smoke message" });
  const incoming = await messagePromise;
  const body = typeof incoming.content === "object" && incoming.content ? incoming.content.body : "";
  assert.equal(body, "integration smoke message", "guild chat message should reach the second member");

  socketA.disconnect(false);
  socketB.disconnect(false);

  console.log("Integration smoke test passed.");
  console.log(JSON.stringify({ userA: userA.username, userB: userB.username, guildId }, null, 2));
}

main().catch((error) => {
  console.error("Integration smoke test failed.");
  console.error(error);
  process.exitCode = 1;
});
