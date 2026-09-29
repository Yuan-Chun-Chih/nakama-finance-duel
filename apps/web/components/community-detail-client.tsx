'use client';

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Crown, Shield, Users } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RealtimeChatPanel } from "@/components/realtime-chat-panel";
import { FinanceDuelMatchPanel } from "@/components/finance-duel-match-panel";
import {
  demoteCommunityMember,
  fetchCommunityDetail,
  inviteCommunityMember,
  leaveGroup,
  leaveGuild,
  promoteCommunityMember,
  transferCommunityOwnership,
  type ChatTarget,
  type CommunityDetail,
} from "@/lib/nakama/service";

export function CommunityDetailClient({ communityId }: { communityId: string }) {
  const router = useRouter();
  // community detail 是 group/guild 共用的輕量頁面。
  // guild 的完整治理仍在 GuildDetailClient，這裡只保留共用 roster/chat 視角。
  const [detail, setDetail] = useState<CommunityDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUsername, setInviteUsername] = useState("");

  useEffect(() => {
    let cancelled = false;

    // 首次載入只抓一次完整 community detail。
    // cancelled guard 用來避免 route 切換或 component unmount 後還 setState。
    void fetchCommunityDetail(communityId)
      .then((next) => {
        if (cancelled) return;
        setDetail(next);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load community detail.");
      });

    return () => {
      cancelled = true;
    };
  }, [communityId]);

  const topMembers = useMemo(() => (detail?.members ?? []).slice(0, 4), [detail?.members]);
  const isGuild = detail?.community.kind === "guild";
  // 這裡的 canManage/canOwn 只控制 UI 顯示。
  // 真正的 invite/promote/transfer 權限仍由 service/runtime 或 Nakama API 判定。
  const canManage = detail?.community.role === "owner" || detail?.community.role === "admin";
  const canOwn = detail?.community.role === "owner";
  const chatTarget = useMemo<ChatTarget | null>(() => {
    if (!detail) return null;
    // chat target 只傳 logical id/kind，不在頁面裡直接建立 channel id。
    // channel join 規則集中在 service 的 realtime helper。
    return {
      id: communityId,
      kind: detail.community.kind,
      label: detail.community.name,
      subtitle: `${detail.community.kind} · ${detail.community.memberCount} members`,
    };
  }, [communityId, detail]);

  async function handleLeave() {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      // group 與 guild 的離開路徑不同：
      // group 走原生 API，guild 走 authoritative RPC。
      if (detail.community.kind === "guild") {
        await leaveGuild(communityId);
      } else {
        await leaveGroup(communityId);
      }
      router.push("/");
      router.refresh();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to leave community.");
    } finally {
      setBusy(false);
    }
  }

  async function reloadDetail() {
    // 成員操作後重抓 detail，而不是本地 patch members。
    // 這樣 role、member count、chat target 等衍生狀態能一起同步。
    const next = await fetchCommunityDetail(communityId);
    setDetail(next);
  }

  async function runMemberAction(job: () => Promise<void>) {
    // 成員治理操作共用同一個錯誤/忙碌狀態，避免每個按鈕各自實作不一致。
    setBusy(true);
    setError(null);
    try {
      await job();
      await reloadDetail();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Community action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleInviteSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !inviteUsername.trim()) return;
    // invite 的實際規則取決於 community kind。
    // guild invite 會走 RPC；group invite 會走 Nakama group user API。
    await runMemberAction(async () => {
      await inviteCommunityMember(communityId, detail.community.kind, inviteUsername.trim());
      setInviteUsername("");
    });
  }

  return (
    <main className="min-h-screen px-4 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <Card className="overflow-hidden border-white/10 bg-[var(--panel)] shadow-[var(--shadow-soft)] backdrop-blur-xl">
          <CardContent className="grid gap-8 px-6 py-6 lg:grid-cols-[1.4fr_0.9fr] lg:px-8 lg:py-8">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-[var(--signal-soft)] text-[var(--signal-strong)]">
                  {isGuild ? "Guild Detail" : "Group Detail"}
                </Badge>
                <Badge variant="outline">{detail?.community.role ?? "member"}</Badge>
                <Badge variant="secondary">{detail?.community.memberCount ?? 0} members</Badge>
              </div>

              <div className="space-y-3">
                <h1 className="text-4xl font-semibold tracking-tight text-white">
                  {detail?.community.name ?? "Loading community..."}
                </h1>
                <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
                  {detail?.community.description ?? "Loading community description."}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button asChild variant="outline">
                  <Link href="/">
                    <ArrowLeft className="size-4" />
                    Back
                  </Link>
                </Button>
                <Button disabled={busy || !detail} variant="destructive" onClick={() => void handleLeave()}>
                  {isGuild ? "Leave guild" : "Leave group"}
                </Button>
                {isGuild ? (
                  <Button asChild variant="secondary">
                    <Link href={`/guilds/${communityId}`}>Open guild governance page</Link>
                  </Button>
                ) : null}
              </div>
            </div>

            <Card className="border-border/80 bg-background/90">
              <CardHeader className="gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-2">
                    <Badge variant="outline">Overview</Badge>
                    <CardTitle className="text-2xl">Community snapshot</CardTitle>
                    <CardDescription>
                      {isGuild
                        ? "Guild governance actions still live on the dedicated guild page."
                        : "Groups use the native Nakama membership model and expose a lightweight roster view."}
                    </CardDescription>
                  </div>
                  {isGuild ? <Shield className="size-5 text-[var(--signal-strong)]" /> : <Users className="size-5 text-[var(--signal-strong)]" />}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <AvatarGroup>
                  {topMembers.map((member) => (
                    <Avatar key={member.userId} size="lg">
                      <AvatarFallback>{initialsFromName(member.displayName || member.username || member.userId)}</AvatarFallback>
                    </Avatar>
                  ))}
                  {detail && detail.members.length > 4 ? (
                    <AvatarGroupCount>+{detail.members.length - 4}</AvatarGroupCount>
                  ) : null}
                </AvatarGroup>
                <Separator />
                <div className="grid gap-3 sm:grid-cols-2">
                  <InfoPill label="Viewer role" value={detail?.community.role ?? "member"} />
                  <InfoPill label="Members" value={String(detail?.members.length ?? 0)} />
                  <InfoPill label="Type" value={detail?.community.kind ?? "group"} />
                  <InfoPill label="Join policy" value={detail?.community.open ? "open" : "invite only"} />
                </div>
              </CardContent>
            </Card>
          </CardContent>
        </Card>

        {error ? <Alert variant="destructive">{error}</Alert> : null}

        <Tabs className="gap-4" defaultValue="members">
          {/* Requests tab 對 group 通常是空狀態；保留它是為了讓 group/guild detail 版型一致。 */}
          <TabsList variant="line">
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="requests">Requests</TabsTrigger>
            <TabsTrigger value="matches">Matches</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
          </TabsList>

          <TabsContent value="members">
            <Card className="border-white/10 bg-[var(--panel)] shadow-[var(--shadow-soft)] backdrop-blur-xl">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-[var(--signal-strong)]" />
                  <CardTitle>{isGuild ? "Guild roster" : "Group roster"}</CardTitle>
                </div>
                <CardDescription>Use this page to inspect current membership and basic community state.</CardDescription>
              </CardHeader>
              <CardContent>
                {canManage ? (
                  // 管理者可從 detail 頁直接邀請成員；實際查詢與權限仍由 service/backend 處理。
                  <form className="mb-4 flex gap-3" onSubmit={(event) => void handleInviteSubmit(event)}>
                    <Input
                      disabled={busy}
                      onChange={(event) => setInviteUsername(event.target.value)}
                      placeholder="Invite by username"
                      value={inviteUsername}
                    />
                    <Button disabled={busy || !inviteUsername.trim()} type="submit">
                      Invite
                    </Button>
                  </form>
                ) : null}
                <ScrollArea className="h-[28rem] rounded-2xl border border-border bg-background/70 p-1">
                  <div className="space-y-3 p-3">
                    {detail?.members.length ? (
                      detail.members.map((member) => (
                        <Card className="border-border bg-white/[0.04] backdrop-blur-sm" key={member.userId}>
                          <CardContent className="flex items-center justify-between gap-3 px-4 py-4">
                            <div className="flex min-w-0 items-center gap-3">
                              <Avatar>
                                <AvatarFallback>{initialsFromName(member.displayName || member.username || member.userId)}</AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="truncate font-medium text-white">
                                  {member.displayName || member.username || member.userId}
                                </p>
                                <p className="truncate text-xs uppercase tracking-[0.14em] text-muted-foreground">
                                  @{member.username}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              {canOwn && member.role === "member" ? (
                                // owner 才能升降權限；UI 隱藏按鈕只是提示，後端仍會再驗證。
                                <Button
                                  disabled={busy}
                                  size="sm"
                                  onClick={() =>
                                    void runMemberAction(() =>
                                      promoteCommunityMember(communityId, detail.community.kind, member.userId),
                                    )
                                  }
                                >
                                  Promote admin
                                </Button>
                              ) : null}
                              {canOwn && member.role === "admin" ? (
                                <Button
                                  disabled={busy}
                                  size="sm"
                                  variant="secondary"
                                  onClick={() =>
                                    void runMemberAction(() =>
                                      demoteCommunityMember(communityId, detail.community.kind, member.userId),
                                    )
                                  }
                                >
                                  Demote admin
                                </Button>
                              ) : null}
                              {canOwn && member.role !== "owner" ? (
                                <Button
                                  disabled={busy}
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    void runMemberAction(() =>
                                      transferCommunityOwnership(communityId, detail.community.kind, member.userId),
                                    )
                                  }
                                >
                                  Transfer owner
                                </Button>
                              ) : null}
                              <Badge variant="secondary">
                                {member.role === "owner" ? (
                                  <>
                                    <Crown className="size-3.5" />
                                    owner
                                  </>
                                ) : (
                                  member.role
                                )}
                              </Badge>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    ) : (
                      <Alert>No members found.</Alert>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="requests">
            <Card className="border-white/10 bg-[var(--panel)] shadow-[var(--shadow-soft)] backdrop-blur-xl">
              <CardHeader>
                <CardTitle>{isGuild ? "Join requests" : "Request queue"}</CardTitle>
                <CardDescription>
                  {isGuild ? "Guild request handling remains on the guild governance page." : "Groups do not use a request queue in this phase."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {detail?.requests.length ? (
                  <div className="space-y-3">
                    {detail.requests.map((request) => (
                      <Card className="border-border bg-white/[0.04] backdrop-blur-sm" key={`${request.guildId}-${request.userId}`}>
                        <CardContent className="px-4 py-4">
                          <p className="font-medium text-white">@{request.username}</p>
                          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{request.userId}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Alert>{isGuild ? "No pending requests in this snapshot." : "Groups have no pending-request queue in phase one."}</Alert>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="matches">
            <div className="mb-4 flex justify-end">
              <Button asChild variant="secondary">
                <Link href={detail ? `/matches/${detail.community.kind}/${communityId}` : `/matches/group/${communityId}`}>
                  Open full arena
                </Link>
              </Button>
            </div>
            <FinanceDuelMatchPanel disabled={!detail || busy} snapshot={null} />
          </TabsContent>

          <TabsContent value="chat">
            {/* detail 頁的 chat 鎖定目前 community，不顯示 dashboard 的 target sidebar。 */}
            <RealtimeChatPanel disabled={!detail} forcedTarget={chatTarget} hideTargetList snapshot={null} />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 px-3 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function initialsFromName(value: string) {
  return value
    .split(/[\s-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
