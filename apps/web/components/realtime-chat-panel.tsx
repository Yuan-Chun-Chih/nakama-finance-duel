'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, Send, Shield, UserRound, Users } from "lucide-react";
import {
  buildChatTargets,
  loadOlderChatMessages,
  markChatTargetRead,
  openChatSession,
  primeRealtimeChat,
  sendChatMessage,
  sendTypingSignal,
  subscribeToChatChannel,
  subscribeToRealtimeMeta,
  subscribeToUnreadCounts,
  type ChatDeliveryState,
  type ChatMessageView,
  type ChatSession,
  type ChatTarget,
  type DashboardSnapshot,
  type RealtimeMetaSnapshot,
} from "@/lib/nakama/service";
import { Alert } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

export function RealtimeChatPanel({
  snapshot,
  disabled,
  forcedTarget,
  hideTargetList = false,
}: {
  snapshot: DashboardSnapshot | null;
  disabled: boolean;
  forcedTarget?: ChatTarget | null;
  hideTargetList?: boolean;
}) {
  // Dashboard 模式會從 snapshot 建立所有可聊天目標；
  // detail 頁則會傳 forcedTarget，讓聊天室直接鎖定當前 group/guild。
  const dynamicTargets = useMemo(() => buildChatTargets(snapshot), [snapshot]);
  const targets = useMemo(() => (forcedTarget ? [forcedTarget] : dynamicTargets), [dynamicTargets, forcedTarget]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [chatSession, setChatSession] = useState<ChatSession | null>(null);
  const [messageBody, setMessageBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [realtimeMeta, setRealtimeMeta] = useState<RealtimeMetaSnapshot>({
    onlineUserIds: [],
    channelPresenceById: {},
    typingByChannelId: {},
  });
  const endRef = useRef<HTMLDivElement | null>(null);
  // 載入舊訊息時不應自動捲到底，否則使用者剛回看歷史就會被拉回最新訊息。
  const suppressNextAutoScrollRef = useRef(false);
  // typing signal 需要節流，避免每次輸入都送 websocket message。
  const lastTypingSignalAtRef = useRef(0);

  const activeTarget = useMemo(() => {
    // forcedTarget 優先，這是 guild/group detail 頁嵌入聊天室的關鍵。
    if (forcedTarget) {
      return forcedTarget;
    }

    return targets.find((target) => getTargetKey(target) === selectedTargetId) ?? targets[0] ?? null;
  }, [forcedTarget, selectedTargetId, targets]);

  useEffect(() => {
    if (!snapshot?.profile) {
      return;
    }

    // 進 dashboard 後先預熱 realtime socket / channel 資訊，
    // 讓 unread / presence 能在使用者打開聊天室前就開始同步。
    void primeRealtimeChat(snapshot).catch(() => {});
  }, [snapshot]);

  useEffect(() => {
    return subscribeToUnreadCounts((counts) => {
      setUnreadCounts(counts);
    });
  }, []);

  useEffect(() => {
    return subscribeToRealtimeMeta((meta) => {
      setRealtimeMeta(meta);
    });
  }, []);

  useEffect(() => {
    if (!activeTarget) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);

      void openChatSession(activeTarget)
        .then((next) => {
          if (cancelled) return;
          markChatTargetRead(activeTarget);
          setChatSession(next);
          suppressNextAutoScrollRef.current = false;
        })
        .catch((loadError) => {
          if (cancelled) return;
          setError(loadError instanceof Error ? loadError.message : "Failed to open chat session.");
          setChatSession(null);
        })
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [activeTarget]);

  useEffect(() => {
    if (!chatSession?.channelId || !activeTarget) {
      return;
    }

    // 每個開啟中的 channel 都會訂閱即時訊息；收到訊息後只更新目前同一個 channel。
    return subscribeToChatChannel(chatSession.channelId, (message) => {
      setChatSession((current) => {
        if (!current || current.channelId !== message.channelId) {
          return current;
        }

        return {
          ...current,
          messages: appendUniqueMessage(current.messages, {
            ...message,
            deliveryState: "sent",
          }),
        };
      });
      markChatTargetRead(activeTarget);
    });
  }, [activeTarget, chatSession?.channelId]);

  useEffect(() => {
    if (suppressNextAutoScrollRef.current) {
      suppressNextAutoScrollRef.current = false;
      return;
    }

    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatSession?.channelId, chatSession?.messages.length]);

  useEffect(() => {
    if (!activeTarget || !messageBody.trim()) {
      return;
    }

    const now = Date.now();
    if (now - lastTypingSignalAtRef.current < 1200) {
      return;
    }

    lastTypingSignalAtRef.current = now;
    // typing signal 是短期 presence 訊號，失敗時不應阻塞正常打字。
    void sendTypingSignal(activeTarget).catch(() => {});
  }, [activeTarget, messageBody]);

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chatSession?.channelId || !messageBody.trim() || !activeTarget) {
      return;
    }

    const optimisticId = `local-${Date.now()}`;
    // 先放一筆 optimistic message，讓使用者立即看到送出中的狀態。
    // 成功後用 server ack 替換；失敗則標成 failed。
    const optimisticMessage: ChatMessageView = {
      id: optimisticId,
      channelId: chatSession.channelId,
      senderId: "self",
      senderName: "You",
      body: messageBody.trim(),
      createdAt: new Date().toISOString(),
      deliveryState: "sending",
    };

    setChatSession((current) =>
      current
        ? {
            ...current,
            messages: appendUniqueMessage(current.messages, optimisticMessage),
          }
        : current,
    );

    setSending(true);
    setError(null);
    try {
      const message = await sendChatMessage(chatSession.channelId, messageBody, activeTarget);
      setChatSession((current) =>
        current
          ? {
              ...current,
              messages: replaceMessageById(current.messages, optimisticId, {
                ...message,
                deliveryState: "sent",
              }),
            }
          : current,
      );
      markChatTargetRead(activeTarget);
      setMessageBody("");
    } catch (sendError) {
      setChatSession((current) =>
        current
          ? {
              ...current,
              messages: markMessageDelivery(current.messages, optimisticId, "failed"),
            }
          : current,
      );
      setError(sendError instanceof Error ? sendError.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  }

  async function handleLoadOlder() {
    if (!chatSession?.prevCursor) {
      return;
    }

    setLoadingOlder(true);
    setError(null);
    try {
      // 載入舊訊息時保留目前閱讀位置，不要自動跳到最新訊息。
      suppressNextAutoScrollRef.current = true;
      const page = await loadOlderChatMessages(chatSession.channelId, chatSession.prevCursor);
      setChatSession((current) =>
        current
          ? {
              ...current,
              messages: mergeMessages(page.messages, current.messages),
              nextCursor: current.nextCursor,
              prevCursor: page.prevCursor,
            }
          : current,
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load older messages.");
    } finally {
      setLoadingOlder(false);
    }
  }

  const activeTypingUsers = chatSession?.channelId ? realtimeMeta.typingByChannelId[chatSession.channelId] ?? [] : [];
  const activeChannelPresence = chatSession?.channelId
    ? realtimeMeta.channelPresenceById[chatSession.channelId] ?? []
    : [];
  const friendOnline = activeTarget?.kind === "friend" ? realtimeMeta.onlineUserIds.includes(activeTarget.id) : false;
  const communityOnlineCount =
    activeTarget?.kind === "group" || activeTarget?.kind === "guild" ? activeChannelPresence.length : 0;

  const content = (
    <Card className="border-white/10 bg-[var(--panel)] shadow-[var(--shadow-soft)] backdrop-blur-xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          {activeTarget?.kind === "friend" ? (
            <UserRound className="size-4 text-[var(--signal-strong)]" />
          ) : activeTarget?.kind === "guild" ? (
            <Shield className="size-4 text-[var(--signal-strong)]" />
          ) : (
            <Users className="size-4 text-[var(--signal-strong)]" />
          )}
          <CardTitle>{activeTarget?.label ?? "Realtime chat"}</CardTitle>
        </div>
        <CardDescription>
          {activeTarget ? activeTarget.subtitle : "Pick a friend, group, or guild to open its channel."}
        </CardDescription>
        {activeTarget ? (
          <div className="flex flex-wrap items-center gap-2">
            {activeTarget.kind === "friend" ? (
              <Badge variant={friendOnline ? "default" : "secondary"}>
                {friendOnline ? "online" : "offline"}
              </Badge>
            ) : (
              <Badge variant="secondary">{communityOnlineCount} online in channel</Badge>
            )}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <Alert variant="destructive">{error}</Alert> : null}

        <ScrollArea className="h-[26rem] rounded-2xl border border-border bg-background/70 p-1">
          <div className="space-y-3 p-3">
            {chatSession?.prevCursor ? (
              <div className="flex justify-center">
                <Button disabled={loadingOlder} size="sm" variant="outline" onClick={() => void handleLoadOlder()}>
                  {loadingOlder ? "Loading..." : "Load older messages"}
                </Button>
              </div>
            ) : null}

            {loading ? (
              <Alert>Opening realtime channel...</Alert>
            ) : chatSession?.messages.length ? (
              <>
                {chatSession.messages.map((message) => (
                  <div className="flex gap-3" key={message.id}>
                    <Avatar>
                      <AvatarFallback>{initialsFromName(message.senderName)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1 rounded-2xl border border-border bg-white/[0.04] px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-white">{message.senderName}</p>
                        <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                          {formatTimestamp(message.createdAt)}
                        </span>
                        {message.deliveryState ? (
                          <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                            {message.deliveryState}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">
                        {message.body}
                      </p>
                    </div>
                  </div>
                ))}
                {activeTypingUsers.length ? (
                  <Alert>{activeTypingUsers.map((entry) => entry.username).join(", ")} is typing...</Alert>
                ) : null}
                <div ref={endRef} />
              </>
            ) : (
              <Alert>{activeTarget ? "No messages yet. Start the conversation." : "No channel selected."}</Alert>
            )}
          </div>
        </ScrollArea>

        <form className="flex gap-3" onSubmit={(event) => void handleSend(event)}>
          <Input
            disabled={disabled || sending || !chatSession}
            onChange={(event) => setMessageBody(event.target.value)}
            placeholder="Type a realtime message..."
            value={messageBody}
          />
          <Button disabled={disabled || sending || !chatSession || !messageBody.trim()} type="submit">
            <Send className="size-4" />
            Send
          </Button>
        </form>
      </CardContent>
    </Card>
  );

  if (hideTargetList || forcedTarget) {
    return content;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[20rem_1fr]">
      <Card className="border-white/10 bg-[var(--panel)] shadow-[var(--shadow-soft)] backdrop-blur-xl">
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageSquare className="size-4 text-[var(--signal-strong)]" />
            <CardTitle>Chat targets</CardTitle>
          </div>
          <CardDescription>
            Accepted friends, joined groups, and guilds are exposed as realtime Nakama channels.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[32rem] rounded-2xl border border-border bg-background/70 p-1">
            <div className="space-y-2 p-3">
              {targets.length ? (
                targets.map((target) => {
                  const targetKey = getTargetKey(target);
                  const selected = targetKey === getTargetKey(activeTarget);
                  const unread = unreadCounts[targetKey] ?? 0;
                  return (
                    <button
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                        selected
                          ? "border-[var(--signal-strong)] bg-white/[0.08]"
                          : "border-border bg-white/[0.03] hover:bg-white/[0.05]"
                      }`}
                      key={targetKey}
                      onClick={() => setSelectedTargetId(targetKey)}
                      type="button"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-white">{target.label}</p>
                          <p className="truncate text-xs uppercase tracking-[0.14em] text-muted-foreground">
                            {target.subtitle}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {target.kind === "friend" && realtimeMeta.onlineUserIds.includes(target.id) ? (
                            <Badge variant="outline">online</Badge>
                          ) : null}
                          {unread > 0 ? <Badge>{unread}</Badge> : null}
                          <Badge variant="secondary">{target.kind}</Badge>
                        </div>
                      </div>
                    </button>
                  );
                })
              ) : (
                <Alert>No chat target yet. Add accepted friends or join a group / guild first.</Alert>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {content}
    </div>
  );
}

function mergeMessages(left: ChatMessageView[], right: ChatMessageView[]) {
  const merged = new Map<string, ChatMessageView>();
  [...left, ...right].forEach((message) => {
    merged.set(message.id, message);
  });
  return [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function appendUniqueMessage(messages: ChatMessageView[], incoming: ChatMessageView) {
  return mergeMessages(messages, [incoming]);
}

function replaceMessageById(messages: ChatMessageView[], currentId: string, next: ChatMessageView) {
  return mergeMessages(
    messages.filter((message) => message.id !== currentId),
    [next],
  );
}

function markMessageDelivery(messages: ChatMessageView[], id: string, deliveryState: ChatDeliveryState) {
  return messages.map((message) => (message.id === id ? { ...message, deliveryState } : message));
}

function getTargetKey(target: ChatTarget | null) {
  if (!target) {
    return "";
  }

  return `${target.kind}:${target.id}`;
}

function initialsFromName(value: string) {
  return value
    .split(/[\s-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatTimestamp(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
