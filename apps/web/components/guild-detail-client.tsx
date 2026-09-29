'use client';

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Crown, UserMinus, UserRoundPlus, Users } from "lucide-react";
import {
  approveGuildJoin,
  demoteCommunityMember,
  disbandGuild,
  fetchGuildDetail,
  inviteCommunityMember,
  kickGuildMember,
  leaveGuild,
  promoteCommunityMember,
  rejectGuildJoin,
  transferCommunityOwnership,
  type ChatTarget,
  type GuildDetail,
  type GuildJoinPolicy,
  updateGuildSettings,
} from "@/lib/nakama/service";
import { RealtimeChatPanel } from "@/components/realtime-chat-panel";
import { FinanceDuelMatchPanel } from "@/components/finance-duel-match-panel";
import { Alert } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export function GuildDetailClient({ guildId }: { guildId: string }) {
  // `guildId` 由 app/guilds/[id]/page.tsx 從路由參數傳進來。
  // 這個 component 是 client component，負責把公會 detail API 資料轉成可互動的治理 UI。
  const router = useRouter();

  // `detail` 是整個頁面的主要資料來源：
  // 包含 guild 基本資料、members、pending requests、audit log、contribution metrics。
  // 初始為 null，代表還在載入，畫面會先顯示 loading fallback。
  const [detail, setDetail] = useState<GuildDetail | null>(null);

  // `busy` 是所有 guild mutation 共用的送出狀態。
  // 任何需要打後端的操作進行中，都會用它 disable 按鈕，避免重複送出同一個 RPC。
  const [busy, setBusy] = useState(false);

  // `error` 只存 UI 要顯示的錯誤文字，不直接存原始 Response / Error object。
  // 原始錯誤已在 service.ts 轉成可 debug 的 `[live:action] ...` 格式。
  const [error, setError] = useState<string | null>(null);

  // 邀請成員表單的暫存 username。
  // 真正檢查使用者是否存在、是否可邀請，仍由 service.ts / Go runtime 處理。
  const [inviteUsername, setInviteUsername] = useState("");

  // 踢人是破壞性操作，所以不是按下 Kick 就直接送出。
  // 先把準備踢出的成員放進 pendingKick，再打開確認 Dialog。
  const [pendingKick, setPendingKick] = useState<{ userId: string; displayName: string } | null>(null);

  // 解散公會同樣是破壞性操作，使用獨立 dialog state 控制二次確認視窗。
  const [disbandDialogOpen, setDisbandDialogOpen] = useState(false);

  // Settings tab 的表單 draft。
  // 它們和 detail.guild.* 分開，是為了讓使用者編輯中不會立即改動畫面上的正式資料。
  const [announcementDraft, setAnnouncementDraft] = useState("");
  const [joinPolicyDraft, setJoinPolicyDraft] = useState<GuildJoinPolicy>("request");

  useEffect(() => {
    let cancelled = false;

    // detail 頁首次進入時只抓一份完整 guild 讀模型，避免 members / requests / audit 分開查。
    // `cancelled` 用來防止使用者快速切頁時，舊 request 回來後還呼叫 setState。
    void fetchGuildDetail(guildId)
      .then((next) => {
        if (cancelled) return;
        // detail 是後端的正式資料；draft 則同步成目前可編輯的初始值。
        setDetail(next);
        setAnnouncementDraft(next.guild.announcement ?? "");
        setJoinPolicyDraft(next.guild.joinPolicy ?? "request");
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load guild detail.");
      });

    return () => {
      cancelled = true;
    };
  }, [guildId]);

  async function reloadDetail() {
    // 所有治理動作成功後都重抓整份 detail，而不是在前端做局部 patch。
    // 這樣可以把權限、請求列表、audit 與 contribution 一次同步。
    // 例如 approve request 後，members、requests、audit 都會同時變動，局部 patch 容易漏資料。
    const next = await fetchGuildDetail(guildId);
    setDetail(next);
    setAnnouncementDraft(next.guild.announcement ?? "");
    setJoinPolicyDraft(next.guild.joinPolicy ?? "request");
  }

  async function run(job: () => Promise<unknown>) {
    // detail 頁的 mutation 同樣集中處理 busy / error，保持治理操作的一致互動。
    // `job` 只負責執行單一後端操作；成功後一律 reloadDetail() 取得最新 authoritative state。
    setBusy(true);
    setError(null);
    try {
      await job();
      await reloadDetail();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Guild action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLeaveGuild() {
    // 離開公會成功後直接導回首頁，因為目前 detail page 的 guild membership 已失效。
    // 若後端判斷 owner 仍不能離開，錯誤會被顯示在本頁。
    setBusy(true);
    setError(null);
    try {
      await leaveGuild(guildId);
      router.push("/");
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Guild action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisbandGuild() {
    // Disband 是 owner-only 的破壞性操作，和 leave guild 分開處理。
    // owner 若只是離開公會，後端會要求先轉移 owner 或解散公會，避免公會失去治理者。
    setBusy(true);
    setError(null);
    try {
      await disbandGuild(guildId);
      setDisbandDialogOpen(false);
      router.push("/");
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Guild action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleInviteSubmit(event: React.FormEvent<HTMLFormElement>) {
    // 邀請成員只接受 username；service.ts 會先查 user，再依 guild 規則呼叫 RPC。
    event.preventDefault();
    if (!inviteUsername.trim()) return;
    await run(() => inviteCommunityMember(guildId, "guild", inviteUsername.trim()));
    setInviteUsername("");
  }

  async function handleSettingsSubmit(event: React.FormEvent<HTMLFormElement>) {
    // settings submit 同時送出 announcement 與 join policy。
    // 後端會再檢查使用者權限：announcement 允許 owner/admin，join policy 通常 owner-only。
    event.preventDefault();
    await run(() => updateGuildSettings(guildId, { announcement: announcementDraft, joinPolicy: joinPolicyDraft }));
  }

  // header 只顯示前四位成員 avatar，剩餘數量由 AvatarGroupCount 表示。
  const topMembers = useMemo(() => (detail?.members ?? []).slice(0, 4), [detail?.members]);

  // `canManage` / `canOwn` 是 UI gate，只決定按鈕是否顯示或 disabled。
  // 真正的權限裁決必須在 Nakama Go runtime 再做一次，避免前端被竄改。
  const canManage = detail?.guild.role === "owner" || detail?.guild.role === "admin";
  const canOwn = detail?.guild.role === "owner";

  // 這個 target 給 RealtimeChatPanel 使用，讓 guild detail 能直接內嵌公會聊天室。
  const chatTarget = useMemo<ChatTarget | null>(() => {
    if (!detail) return null;
    // guild chat 只傳遞「公會 id + guild kind」給共用聊天室元件。
    // 實際 join channel / send message 的 Nakama 細節集中在 service.ts，避免 detail page 自己組 socket protocol。
    // guild chat target 與 guild id 綁定，但 UI 只暴露讀模型，不讓頁面自己拼 channel id。
    return {
      id: guildId,
      kind: "guild",
      label: detail.guild.name,
      subtitle: `guild · ${detail.guild.memberCount} members`,
    };
  }, [detail, guildId]);

  return (
    <main className="min-h-screen px-4 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        {/* 頂部 hero 區塊：左側顯示公會基本資料與主要操作，右側顯示治理摘要。
            這裡使用 `detail?.` 是為了讓首次載入時仍能顯示穩定骨架文字。 */}
        <Card className="overflow-hidden border-white/10 bg-[var(--panel)] shadow-[var(--shadow-soft)] backdrop-blur-xl">
          <CardContent className="grid gap-8 px-6 py-6 lg:grid-cols-[1.4fr_0.9fr] lg:px-8 lg:py-8">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-[var(--signal-soft)] text-[var(--signal-strong)]">Guild Detail</Badge>
                <Badge variant="outline">{detail?.guild.role ?? "member"}</Badge>
                <Badge variant="secondary">{detail?.guild.memberCount ?? 0} members</Badge>
              </div>

              <div className="space-y-3">
                <h1 className="text-4xl font-semibold tracking-tight text-white">
                  {detail?.guild.name ?? "Loading guild..."}
                </h1>
                <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
                  {detail?.guild.description ?? "Loading guild description."}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                {/* Back 只回 dashboard，不做資料 mutation。 */}
                <Button asChild variant="outline">
                  <Link href="/">
                    <ArrowLeft className="size-4" />
                    Back
                  </Link>
                </Button>

                {/* Leave guild 是一般成員 / admin / owner 都可能看到的入口。
                    owner 若還有其他成員，後端會拒絕並提示要 transfer owner 或 disband。 */}
                <Button disabled={busy} variant="destructive" onClick={() => void handleLeaveGuild()}>
                  <UserMinus className="size-4" />
                  Leave guild
                </Button>
                {canOwn ? (
                  // 解散公會會刪除 group 與所有成員的 guild_membership storage，必須要求二次確認。
                  <Dialog open={disbandDialogOpen} onOpenChange={setDisbandDialogOpen}>
                    <DialogTrigger asChild>
                      <Button disabled={busy} variant="destructive">
                        Disband guild
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Disband guild</DialogTitle>
                        <DialogDescription>
                          Permanently remove this guild and clear guild membership for all current members. This action is
                          only available to the owner.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button disabled={busy} variant="outline" onClick={() => setDisbandDialogOpen(false)}>
                          Cancel
                        </Button>
                        <Button disabled={busy} variant="destructive" onClick={() => void handleDisbandGuild()}>
                          Confirm disband
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                ) : null}
              </div>
            </div>

            {/* Governance snapshot 是「讀模型摘要」，讓 reviewer 快速看到目前 viewer role、
                pending request 數量、join policy 與提交分數的人數。 */}
            <Card className="border-border/80 bg-background/90">
              <CardHeader className="gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-2">
                    <Badge variant="outline">Overview</Badge>
                    <CardTitle className="text-2xl">Governance snapshot</CardTitle>
                    <CardDescription>
                      Guild ownership transfer and admin promotion now use authoritative RPC actions.
                    </CardDescription>
                  </div>
                  <Crown className="size-5 text-[var(--signal-strong)]" />
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
                  <InfoPill label="Viewer role" value={detail?.guild.role ?? "member"} />
                  <InfoPill label="Pending requests" value={String(detail?.requests.length ?? 0)} />
                  <InfoPill label="Members" value={String(detail?.members.length ?? 0)} />
                  <InfoPill label="Type" value="Guild" />
                  <InfoPill label="Join policy" value={detail?.guild.joinPolicy ?? "request"} />
                  <InfoPill label="Submitted scores" value={String(detail?.metrics.submittedMembers ?? 0)} />
                </div>
                <Separator />
                <div className="space-y-2 rounded-2xl border border-border bg-muted/20 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Announcement</p>
                  <p className="text-sm leading-6 text-foreground">
                    {detail?.guild.announcement || "No guild announcement has been published yet."}
                  </p>
                </div>
              </CardContent>
            </Card>
          </CardContent>
        </Card>

        {error ? <Alert variant="destructive">{error}</Alert> : null}

        <Tabs className="gap-4" defaultValue="members">
          {/* Tabs 將同一份 GuildDetail 拆成不同 review 視角：
              roster 看成員治理、requests 看審核、insights 看設定與分數、audit 看後端事件、chat 看即時溝通。 */}
          <TabsList variant="line">
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="requests">Pending Requests</TabsTrigger>
            <TabsTrigger value="insights">Insights</TabsTrigger>
            <TabsTrigger value="audit">Audit Log</TabsTrigger>
            <TabsTrigger value="matches">Matches</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
          </TabsList>

          <TabsContent value="members">
            <Card className="border-white/10 bg-[var(--panel)] shadow-[var(--shadow-soft)] backdrop-blur-xl">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-[var(--signal-strong)]" />
                  <CardTitle>Guild roster</CardTitle>
                </div>
                <CardDescription>
                  Owners can invite members, promote or demote admins, transfer ownership, and kick non-owner members.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {canManage ? (
                  // owner/admin 可以看到邀請表單；runtime 仍會驗證權限與目標使用者狀態。
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
                        // 每個 member card 都從後端 members 讀模型產生，不在前端自行推導 role。
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
                                // promote/demote/transfer 都是 owner-only UI；後端仍會用 caller id 再檢查。
                                <Button
                                  disabled={busy}
                                  size="sm"
                                  onClick={() => void run(() => promoteCommunityMember(guildId, "guild", member.userId))}
                                >
                                  Promote admin
                                </Button>
                              ) : null}

                              {canOwn && member.role === "admin" ? (
                                <Button
                                  disabled={busy}
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => void run(() => demoteCommunityMember(guildId, "guild", member.userId))}
                                >
                                  Demote admin
                                </Button>
                              ) : null}

                              {canOwn && member.role !== "owner" ? (
                                // Transfer owner 成功後目前 viewer 會失去 owner 權限，因此成功後必須 reloadDetail。
                                <Button
                                  disabled={busy}
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    void run(() => transferCommunityOwnership(guildId, "guild", member.userId))
                                  }
                                >
                                  Transfer owner
                                </Button>
                              ) : null}

                              {canOwn && member.role !== "owner" ? (
                                // Kick 使用 Dialog 二次確認，避免誤點直接移除成員。
                                // owner 不能被 kick，所以 UI 只對非 owner member 顯示。
                                <Dialog
                                  open={pendingKick?.userId === member.userId}
                                  onOpenChange={(open) =>
                                    setPendingKick(
                                      open
                                        ? {
                                            userId: member.userId,
                                            displayName: member.displayName || member.username || member.userId,
                                          }
                                        : null,
                                    )
                                  }
                                >
                                  <DialogTrigger asChild>
                                    <Button
                                      disabled={busy}
                                      size="sm"
                                      variant="destructive"
                                      onClick={() =>
                                        setPendingKick({
                                          userId: member.userId,
                                          displayName: member.displayName || member.username || member.userId,
                                        })
                                      }
                                    >
                                      <UserMinus className="size-4" />
                                      Kick
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent>
                                    <DialogHeader>
                                      <DialogTitle>Kick guild member</DialogTitle>
                                      <DialogDescription>
                                        Remove {pendingKick?.displayName} from this guild. The server will reject invalid targets.
                                      </DialogDescription>
                                    </DialogHeader>
                                    <DialogFooter>
                                      <Button
                                        disabled={busy || !pendingKick}
                                        variant="destructive"
                                        onClick={() => {
                                          if (!pendingKick) return;
                                          void run(() => kickGuildMember(guildId, pendingKick.userId)).then(() => {
                                            setPendingKick(null);
                                          });
                                        }}
                                      >
                                        Confirm kick
                                      </Button>
                                    </DialogFooter>
                                  </DialogContent>
                                </Dialog>
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
                <div className="flex items-center gap-2">
                  <UserRoundPlus className="size-4 text-[var(--signal-strong)]" />
                  <CardTitle>Approval queue</CardTitle>
                </div>
                <CardDescription>
                  Approve or reject pending join requests. Successful actions re-fetch the full guild detail.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[28rem] rounded-2xl border border-border bg-background/70 p-1">
                  <div className="space-y-3 p-3">
                    {detail?.requests.length ? (
                      detail.requests.map((request) => (
                        // request 來自 guild_join_requests storage；approve 後會加入 group roster 並刪除 request。
                        <Card className="border-border bg-white/[0.04] backdrop-blur-sm" key={`${request.guildId}-${request.userId}`}>
                          <CardContent className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <Avatar>
                                <AvatarFallback>{initialsFromName(request.username)}</AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="truncate font-medium text-white">@{request.username}</p>
                                <p className="truncate text-xs uppercase tracking-[0.14em] text-muted-foreground">
                                  {request.userId}
                                </p>
                              </div>
                            </div>
                            <div className="mt-4 flex gap-2">
                              <Button
                                disabled={busy}
                                size="sm"
                                onClick={() => void run(() => approveGuildJoin(guildId, request.userId))}
                              >
                                Approve
                              </Button>
                              <Button
                                disabled={busy}
                                size="sm"
                                variant="destructive"
                                onClick={() => void run(() => rejectGuildJoin(guildId, request.userId))}
                              >
                                Reject
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    ) : (
                      <Alert>No pending requests.</Alert>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="insights">
            <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
              {/* Settings panel 管理 guild_config：
                  announcement 用於公告，joinPolicy 用於 request / invite_only 加入規則。 */}
              <Card className="border-white/10 bg-[var(--panel)] shadow-[var(--shadow-soft)] backdrop-blur-xl">
                <CardHeader>
                  <CardTitle>Guild settings</CardTitle>
                  <CardDescription>Owner can change join policy. Admins and owners can maintain the guild announcement.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="space-y-4" onSubmit={(event) => void handleSettingsSubmit(event)}>
                    {/* join policy 與 announcement 都由 server 儲存；
                        owner/admin 權限只在 UI 上做可視限制，真正裁決仍在 runtime。 */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Join policy</p>
                      <Select disabled={!canOwn || busy} onValueChange={(value) => setJoinPolicyDraft(value as GuildJoinPolicy)} value={joinPolicyDraft}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="request">Request to join</SelectItem>
                          <SelectItem value="invite_only">Invite only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Announcement</p>
                      <Textarea
                        disabled={!canManage || busy}
                        onChange={(event) => setAnnouncementDraft(event.target.value)}
                        placeholder="Share the current strategy, weekly focus, or onboarding note."
                        rows={5}
                        value={announcementDraft}
                      />
                    </div>
                    <Button disabled={busy || (!canManage && !canOwn)} type="submit">
                      Save settings
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-[var(--panel)] shadow-[var(--shadow-soft)] backdrop-blur-xl">
                <CardHeader>
                  <CardTitle>Contribution snapshot</CardTitle>
                  <CardDescription>Latest submitted portfolio scores per member, ordered by current contribution signal.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 grid gap-3 sm:grid-cols-2">
                    <InfoPill label="Guild average" value={String(detail?.metrics.averageScore ?? 0)} />
                    <InfoPill label="Scored members" value={String(detail?.metrics.submittedMembers ?? 0)} />
                  </div>
                  {/* contribution panel 是給 review / 營運看 guild 內部組成，
                      不是排行榜真相來源；真實榜單仍以 authoritative leaderboard 為準。 */}
                  <ScrollArea className="h-[24rem] rounded-2xl border border-border bg-background/70 p-1">
                    <div className="space-y-3 p-3">
                      {detail?.contributions.length ? (
                        detail.contributions.map((entry) => (
                          // contribution entry 由後端根據 portfolio_scores 與 guild members 組合。
                          // 沒有提交 score 的成員仍會顯示，方便確認 guild average 的樣本數。
                          <Card className="border-border bg-white/[0.04] backdrop-blur-sm" key={entry.userId}>
                            <CardContent className="flex items-center justify-between gap-3 px-4 py-4">
                              <div className="min-w-0">
                                <p className="truncate font-medium text-white">{entry.displayName || entry.username || entry.userId}</p>
                                <p className="truncate text-xs uppercase tracking-[0.14em] text-muted-foreground">@{entry.username}</p>
                              </div>
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                <Badge variant="outline">{entry.role}</Badge>
                                {entry.hasScore ? <Badge variant="secondary">score {entry.latestScore}</Badge> : <Badge variant="secondary">no score</Badge>}
                                {entry.hasScore ? (
                                  <Badge variant={Number(entry.deltaFromAverage ?? 0) >= 0 ? "default" : "destructive"}>
                                    Δ {entry.deltaFromAverage}
                                  </Badge>
                                ) : null}
                              </div>
                            </CardContent>
                          </Card>
                        ))
                      ) : (
                        <Alert>No contribution records available yet.</Alert>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="audit">
            <Card className="border-white/10 bg-[var(--panel)] shadow-[var(--shadow-soft)] backdrop-blur-xl">
              <CardHeader>
                <CardTitle>Guild audit log</CardTitle>
                <CardDescription>Authoritative governance events emitted by the Go runtime.</CardDescription>
              </CardHeader>
              <CardContent>
                {/* audit log 是後端 emitted 的治理事件，不是前端自行推導的 activity feed。 */}
                <ScrollArea className="h-[30rem] rounded-2xl border border-border bg-background/70 p-1">
                  <div className="space-y-3 p-3">
                    {detail?.audit.length ? (
                      detail.audit.map((entry) => (
                        <Card className="border-border bg-white/[0.04] backdrop-blur-sm" key={entry.id}>
                          <CardContent className="space-y-2 px-4 py-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">{entry.action}</Badge>
                              <Badge variant="secondary">{formatAuditTime(entry.createdAt)}</Badge>
                            </div>
                            <p className="text-sm text-foreground">{entry.summary}</p>
                            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                              actor: @{entry.actorName || entry.actorId}
                              {entry.targetName || entry.targetUserId ? ` · target: @${entry.targetName || entry.targetUserId}` : ""}
                            </p>
                          </CardContent>
                        </Card>
                      ))
                    ) : (
                      <Alert>No audit events recorded yet.</Alert>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="matches">
            <div className="mb-4 flex justify-end">
              <Button asChild variant="secondary">
                <Link href={`/matches/guild/${guildId}`}>Open full arena</Link>
              </Button>
            </div>
            <FinanceDuelMatchPanel disabled={!detail || busy} snapshot={null} />
          </TabsContent>

          <TabsContent value="chat">
            {/* detail page 的聊天室不顯示 target list，因為這裡已經固定在目前 guild。
                `snapshot={null}` 代表不從 dashboard 自動產生聊天對象。 */}
            <RealtimeChatPanel disabled={!detail} forcedTarget={chatTarget} hideTargetList snapshot={null} />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  // 小型資訊格，專門用來呈現不可互動的摘要數字或狀態。
  // 保持它很單純，可以避免 overview 區塊混入 guild 業務邏輯。
  return (
    <div className="rounded-xl border border-border bg-muted/40 px-3 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function initialsFromName(value: string) {
  // Avatar fallback：從顯示名稱 / username / userId 取前兩段字首。
  // 這樣即使沒有頭像 URL，成員列表仍然能快速辨識不同使用者。
  return value
    .split(/[\s-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatAuditTime(value: string) {
  // audit log 的 createdAt 由後端輸出；這裡只負責轉成台灣常用的短日期時間格式。
  // 如果傳入值不是合法日期，就保留原字串，避免 UI 因單筆資料格式異常而崩潰。
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
