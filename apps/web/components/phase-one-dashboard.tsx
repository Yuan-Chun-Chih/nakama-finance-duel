'use client';

import Link from "next/link";
import { startTransition, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Crown,
  Shield,
  Trophy,
  UserPlus,
  Users,
  Waves,
} from "lucide-react";
import {
  acceptFriend,
  approveGuildJoin,
  bootstrapPhaseOne,
  createCommunity,
  joinCommunity,
  leaveGroup,
  leaveGuild,
  loginWithEmail,
  logoutFromRuntime,
  registerWithEmail,
  rejectFriend,
  rejectGuildJoin,
  removeFriend,
  requestGuildJoin,
  searchUsersForFriendInvite,
  sendFriendInvite,
  type AuthPayload,
  type CommunityPayload,
  type CommunityView,
  type DashboardSnapshot,
  type UserSearchCandidate,
} from "@/lib/nakama/service";
import { FinanceDuelMatchPanel } from "@/components/finance-duel-match-panel";
import { RealtimeChatPanel } from "@/components/realtime-chat-panel";
import { Alert } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { cn } from "@/lib/utils";

type AuthMode = "login" | "register";
type CommunityKind = "group" | "guild";

function createEmptyAuth(): AuthPayload {
  return { email: "", password: "", username: "" };
}

function createEmptyCommunity(): CommunityPayload {
  return { name: "", description: "", kind: "group", open: true };
}

export function PhaseOneDashboard() {
  // `snapshot` 是首頁所有 live 資料的單一讀模型。
  // 這裡刻意不把 friends / communities / leaderboards 拆成多份 state，
  // 因為它們本質上都來自同一次 dashboard bootstrap 或 mutation 後重抓。
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  // `booting` 只表示首頁第一次載入 runtime context；
  // `busy` 則表示使用者正在執行某個會改後端狀態的操作。
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);

  // Access / Dialog / 搜尋輸入等都維持在首頁本地 state，
  // 因為它們屬於暫時 UI 狀態，不該污染後端 snapshot。
  const [authMode, setAuthMode] = useState<AuthMode>("register");
  const [authForm, setAuthForm] = useState<AuthPayload>(createEmptyAuth);
  // 新增好友 dialog 的玩家搜尋輸入：用來查「尚未加好友的 Nakama 使用者」。
  const [friendInviteUsername, setFriendInviteUsername] = useState("");
  // Friends 清單上的本地搜尋輸入：只過濾 snapshot.friends 裡已存在的好友關係。
  const [existingFriendSearchQuery, setExistingFriendSearchQuery] = useState("");
  const [friendInviteUserMatches, setFriendInviteUserMatches] = useState<UserSearchCandidate[]>([]);
  const [friendInviteUserSearching, setFriendInviteUserSearching] = useState(false);
  const [communityForm, setCommunityForm] = useState<CommunityPayload>(createEmptyCommunity);
  const [communitySearch, setCommunitySearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [friendDialogOpen, setFriendDialogOpen] = useState(false);
  const [communityDialogOpen, setCommunityDialogOpen] = useState(false);
  const profile = snapshot?.profile;
  const runtimeMode = snapshot?.runtime.mode ?? "nakama";
  // 是否登入不靠額外旗標，而是直接看 snapshot 裡有沒有 profile。
  const loggedIn = Boolean(profile);

  useEffect(() => {
    let cancelled = false;

    // 首頁只做一次 bootstrap，之後都以 snapshot 作為單一畫面真相來源。
    void bootstrapPhaseOne()
      .then((next) => {
        if (cancelled) return;
        startTransition(() => setSnapshot(next));
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(normalizeError(loadError));
      })
      .finally(() => {
        if (cancelled) return;
        setBooting(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!friendDialogOpen || !loggedIn) {
      return;
    }

    const query = friendInviteUsername.trim();
    if (query.length < 2) {
      return;
    }

    let cancelled = false;
    // 好友搜尋故意做短 debounce，避免每個 key stroke 都打一次搜尋 RPC。
    const timer = window.setTimeout(() => {
      void searchUsersForFriendInvite(query)
        .then((users) => {
          if (cancelled) return;
          const existingFriendUsernames = new Set((snapshot?.friends ?? []).map((friend) => friend.username.toLowerCase()));
          const selfUserId = snapshot?.profile?.id ?? "";
          const selfUsername = snapshot?.profile?.username?.toLowerCase() ?? "";
          setFriendInviteUserMatches(
            users.filter((user) => {
              const username = user.username.toLowerCase();
              return user.userId !== selfUserId && username !== selfUsername && !existingFriendUsernames.has(username);
            }),
          );
        })
        .catch((searchError) => {
          if (cancelled) return;
          setFriendInviteUserMatches([]);
          setError(normalizeError(searchError));
        })
        .finally(() => {
          if (cancelled) return;
          setFriendInviteUserSearching(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [friendDialogOpen, friendInviteUsername, loggedIn, snapshot?.friends, snapshot?.profile?.id, snapshot?.profile?.username]);

  function handleFriendDialogOpenChange(open: boolean) {
    setFriendDialogOpen(open);
    if (!open) {
      // 關閉對話框時同步清掉候選清單，避免下次打開看到上一輪搜尋結果。
      setFriendInviteUserMatches([]);
      setFriendInviteUserSearching(false);
    }
  }

  function handleFriendInviteUsernameChange(value: string) {
    // 這裡只負責更新「新增好友」輸入值與搜尋 loading 狀態；
    // 真正的後端玩家搜尋由 effect + debounce 執行。
    setFriendInviteUsername(value);
    if (value.trim().length < 2) {
      setFriendInviteUserMatches([]);
      setFriendInviteUserSearching(false);
      return;
    }
    if (friendDialogOpen && loggedIn) {
      setFriendInviteUserSearching(true);
    }
  }

  async function runMutation<T>(job: () => Promise<T>, onSuccess: (value: T) => void) {
    // 所有會改動後端狀態的操作都走同一個 mutation 包裝，
    // 這樣 busy / error / message 的互動規則才不會在各 handler 漂移。
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const value = await job();
      startTransition(() => onSuccess(value));
    } catch (mutationError) {
      setError(normalizeError(mutationError));
    } finally {
      setBusy(false);
    }
  }

  async function handleAuthSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action = authMode === "register" ? registerWithEmail : loginWithEmail;
    // register / login 共用同一條 mutation 流，差異只在 action 選擇與成功訊息。
    await runMutation(() => action(authForm), (next) => {
      setSnapshot(next);
      setMessage(authMode === "register" ? "Registration completed." : "Login completed.");
      setAuthForm(createEmptyAuth());
    });
  }

  async function handleFriendSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!friendInviteUsername.trim()) {
      setError("Friend username is required.");
      return;
    }

    // 好友邀請送出後直接重抓 snapshot，讓 inbound / outbound / accepted 狀態一次同步。
    await runMutation(() => sendFriendInvite(friendInviteUsername.trim()), (next) => {
      setSnapshot(next);
      setFriendInviteUsername("");
      setFriendInviteUserMatches([]);
      setFriendDialogOpen(false);
      setMessage("Friend workflow updated.");
    });
  }

  async function handleCommunitySubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!communityForm.name.trim()) {
      setError("Community name is required.");
      return;
    }

    // 社群建立成功後不在前端手動 append 清單，而是以後端回傳的新 snapshot 為準。
    await runMutation(() => createCommunity(communityForm), (next) => {
      setSnapshot(next);
      setCommunityForm(createEmptyCommunity());
      setCommunityDialogOpen(false);
      setMessage(communityForm.kind === "guild" ? "Guild created." : "Community created.");
    });
  }

  async function handleLogout() {
    // 登出後會回到「只有 Access」的首頁分支，不保留社交/公會畫面。
    await runMutation(logoutFromRuntime, (next) => {
      setSnapshot(next);
      setMessage("Session cleared.");
    });
  }

  async function handleGuildJoinRequest(guildId: string) {
    await runMutation(() => requestGuildJoin(guildId), (next) => {
      setSnapshot(next);
      setMessage("Guild join request submitted.");
    });
  }

  async function handleCommunityJoin(communityId: string) {
    await runMutation(() => joinCommunity(communityId), (next) => {
      setSnapshot(next);
      setMessage("Community joined.");
    });
  }

  async function handleGuildJoinApproval(guildId: string, userId: string) {
    await runMutation(() => approveGuildJoin(guildId, userId), (next) => {
      setSnapshot(next);
      setMessage("Guild join request approved.");
    });
  }

  async function handleGuildJoinRejection(guildId: string, userId: string) {
    await runMutation(() => rejectGuildJoin(guildId, userId), (next) => {
      setSnapshot(next);
      setMessage("Guild join request rejected.");
    });
  }

  async function handleGuildLeave() {
    const guildId = primaryGuild?.id;
    await runMutation(() => leaveGuild(guildId), (next) => {
      setSnapshot(next);
      setMessage("You left the guild.");
    });
  }

  async function handleGroupLeave(communityId: string) {
    await runMutation(() => leaveGroup(communityId), (next) => {
      setSnapshot(next);
      setMessage("You left the group.");
    });
  }

  async function handleFriendAccept(friendId: string) {
    await runMutation(() => acceptFriend(friendId), (next) => {
      setSnapshot(next);
      setMessage("Friend request accepted.");
    });
  }

  async function handleFriendReject(friendId: string) {
    await runMutation(() => rejectFriend(friendId), (next) => {
      setSnapshot(next);
      setMessage("Friend request removed.");
    });
  }

  async function handleFriendRemove(friendId: string) {
    await runMutation(() => removeFriend(friendId), (next) => {
      setSnapshot(next);
      setMessage("Friend removed.");
    });
  }

  const guildCount = (snapshot?.communities ?? []).filter((community) => community.kind === "guild").length;
  const friendCount = snapshot?.friends.length ?? 0;
  const queueCount = totalPendingRequests(snapshot?.communities ?? []);

  // 搜尋只做前端模糊過濾；真正資料來源仍是目前這份 snapshot。
  const filteredExistingFriends = useMemo(
    () =>
      (snapshot?.friends ?? []).filter((friend) =>
        fuzzyMatch([friend.displayName, friend.username, friend.state], existingFriendSearchQuery),
      ),
    [existingFriendSearchQuery, snapshot?.friends],
  );

  const filteredCommunities = useMemo(
    () =>
      (snapshot?.communities ?? []).filter((community) =>
        fuzzyMatch([community.name, community.description, community.kind, community.role], communitySearch),
      ),
    [communitySearch, snapshot?.communities],
  );

  const primaryGuild =
    (snapshot?.communities ?? []).find(
      (community) =>
        community.kind === "guild" &&
        (community.role === "owner" || community.role === "admin" || community.role === "member"),
    ) ?? null;
  // `primaryGuild` 是首頁治理摘要用的「主公會視角」。
  // 目前假設單一使用者只會有一個有效 guild membership。

  return (
    <main className="min-h-screen px-4 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        {!loggedIn ? (
          <>
            {/* 未登入時保留產品介紹與 Access，
                但不顯示朋友、公會、榜單、聊天等登入後操作介面。 */}
            <Card className="overflow-hidden border-white/10 bg-[var(--panel)] shadow-[var(--shadow-soft)] backdrop-blur-xl">
              <CardContent className="grid gap-8 px-6 py-6 lg:grid-cols-[1.45fr_0.95fr] lg:px-10 lg:py-10">
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>Phase 1</Badge>
                    <Badge variant="outline">Nakama Live</Badge>
                    <Badge className="bg-[var(--signal-soft)] text-[var(--signal-strong)]">Finance Game Foundation</Badge>
                  </div>

                  <div className="space-y-3">
                    <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--signal-strong)]">
                      Social + Ranking Infrastructure
                    </p>
                    <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                      Build a finance game around identity, friends, communities, guild governance, rankings, and chat.
                    </h1>
                    <p className="max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
                      This phase-one dashboard is the operational shell for your product. Players authenticate first, then
                      unlock social graphs, community workflows, leaderboard submission, and realtime collaboration.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <MetricCard
                      icon={<Users className="size-4" />}
                      label="Friends"
                      value="01"
                      note="Native Nakama friend graph for invites and approvals"
                    />
                    <MetricCard
                      icon={<Shield className="size-4" />}
                      label="Guilds"
                      value="02"
                      note="Private governance layer on top of shared group primitives"
                    />
                    <MetricCard
                      icon={<Trophy className="size-4" />}
                      label="Rankings"
                      value="03"
                      note="Personal and guild-average boards backed by server logic"
                    />
                  </div>
                </div>

                <Panel
                  eyebrow="Access"
                  title="Identity and session"
                  subtitle="Email authentication remains the phase-one entrypoint for real Nakama accounts."
                >
                  {/* Access 只處理身份進入，不承擔任何 gameplay state。
                      成功登入後，整個頁面會切換到已登入分支。 */}
                  <div className="mb-4 inline-flex rounded-full border border-border bg-muted/60 p-1">
                    {(["register", "login"] as const).map((mode) => (
                      <Button
                        key={mode}
                        className={cn("rounded-full", authMode === mode ? "" : "shadow-none")}
                        size="sm"
                        variant={authMode === mode ? "default" : "ghost"}
                        onClick={() => setAuthMode(mode)}
                      >
                        {mode === "register" ? "Register" : "Login"}
                      </Button>
                    ))}
                  </div>

                  <form className="space-y-4" key={authMode} onSubmit={(event) => void handleAuthSubmit(event)}>
                    <Field
                      label="Email"
                      placeholder="trader@alpha-lab.dev"
                      type="email"
                      value={authForm.email}
                      onChange={(value) => setAuthForm((current) => ({ ...current, email: value }))}
                    />
                    <Field
                      label="Password"
                      placeholder="minimum 8 characters"
                      type="password"
                      value={authForm.password}
                      onChange={(value) => setAuthForm((current) => ({ ...current, password: value }))}
                    />
                    {authMode === "register" ? (
                      <Field
                        label="Username"
                        placeholder="market-maker"
                        value={authForm.username ?? ""}
                        onChange={(value) => setAuthForm((current) => ({ ...current, username: value }))}
                      />
                    ) : null}
                    <Button className="w-full" disabled={busy || booting} size="lg" type="submit">
                      {busy ? "Working..." : authMode === "register" ? "Create account" : "Start session"}
                    </Button>
                  </form>

                  {message ? <Alert className="mt-4 border-emerald-200 bg-emerald-50 text-emerald-900">{message}</Alert> : null}
                  {error ? (
                    <Alert className="mt-4" variant="destructive">
                      {error}
                    </Alert>
                  ) : null}
                  {booting ? <Alert className="mt-4">Loading runtime context...</Alert> : null}
                </Panel>
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            {/* 已登入後首頁轉為操作控制台：
                上方是身份與 runtime 摘要，下方才是各模組 tabs。 */}
            <Card className="overflow-hidden border-white/10 bg-[var(--panel)] shadow-[var(--shadow-soft)] backdrop-blur-xl">
              <CardContent className="grid gap-8 px-6 py-6 lg:grid-cols-[1.5fr_1fr] lg:px-10 lg:py-10">
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>Phase 1</Badge>
                    <Badge variant="outline">Nakama Live</Badge>
                    <Badge className="bg-[var(--signal-soft)] text-[var(--signal-strong)]">Social Backbone</Badge>
                  </div>

                  <div className="space-y-3">
                    <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--signal-strong)]">
                      Finance Game Foundation
                    </p>
                    <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                      Phase-one social, governance, ranking, and realtime collaboration controls.
                    </h1>
                    <p className="max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
                      Friends, communities, guild workflows, leaderboards, and chat all run through the live Nakama
                      backend in this dashboard.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <MetricCard
                      icon={<Users className="size-4" />}
                      label="Friends"
                      value={String(friendCount).padStart(2, "0")}
                      note="Accepted and pending relationships"
                    />
                    <MetricCard
                      icon={<Shield className="size-4" />}
                      label="Guilds"
                      value={String(guildCount).padStart(2, "0")}
                      note="Groups and guilds share one base model"
                    />
                    <MetricCard
                      icon={<Waves className="size-4" />}
                      label="Guild Queue"
                      value={String(queueCount).padStart(2, "0")}
                      note="Pending applications visible to managers"
                    />
                  </div>
                </div>

                <Card className="border-border/80 bg-background/90">
                  <CardHeader className="gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2">
                        <Badge variant="outline">Runtime</Badge>
                        <CardTitle className="text-2xl">{`Signed in as ${profile?.displayName}`}</CardTitle>
                        <CardDescription>Live mode is active. Operations go to Nakama and PostgreSQL.</CardDescription>
                      </div>
                      <Button disabled={busy} variant="outline" onClick={() => void handleLogout()}>
                        Logout
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-3 rounded-xl bg-muted/60 p-3">
                      <Avatar size="lg">
                        <AvatarFallback>{initialsFromProfile(profile?.displayName ?? profile?.username ?? "NA")}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{profile?.displayName}</p>
                        <p className="truncate text-sm text-muted-foreground">@{profile?.username}</p>
                      </div>
                    </div>
                    <Separator />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <InfoPill label="Guild policy" value="One user -> one guild" />
                      <InfoPill label="Guild ranking" value="Average return" />
                      <InfoPill label="Runtime" value={runtimeMode} />
                      <InfoPill label="User ID" value={profile?.id ?? "-"} />
                    </div>

                    {message ? <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">{message}</Alert> : null}
                    {error ? <Alert variant="destructive">{error}</Alert> : null}
                    {booting ? <Alert>Loading runtime context...</Alert> : null}
                  </CardContent>
                </Card>
              </CardContent>
            </Card>

            <Panel
              eyebrow="Guild Snapshot"
              title="Current governance view"
              subtitle="Use this as your quick operational read before drilling into the detail page."
            >
              {/* 這裡不是完整 guild detail，而是首頁給 owner/member 的快速治理摘要。 */}
              {primaryGuild ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-border bg-background/80 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Crown className="size-4 text-[var(--signal-strong)]" />
                          <p className="font-semibold text-white">{primaryGuild.name}</p>
                        </div>
                        <p className="text-sm leading-6 text-muted-foreground">{primaryGuild.description}</p>
                      </div>
                      <Badge variant="secondary">{primaryGuild.role}</Badge>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Badge variant="outline">{primaryGuild.memberCount} members</Badge>
                      <Badge variant="outline">{primaryGuild.pendingRequests.length} pending</Badge>
                      <Badge variant="outline">{primaryGuild.open ? "open" : "invite only"}</Badge>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="secondary">
                      <Link href={`/guilds/${primaryGuild.id}`}>Open guild detail</Link>
                    </Button>
                    <Button disabled={busy} variant="destructive" onClick={() => void handleGuildLeave()}>
                      Leave guild
                    </Button>
                  </div>
                </div>
              ) : (
                <Alert>No active guild membership found. Create one or request to join from the Communities tab.</Alert>
              )}
            </Panel>

            <Tabs className="gap-4" defaultValue="friends">
              {/* tabs 對應 phase-one 的主要 live workflows：
                  social graph、communities、leaderboards、relayed matches、realtime chat。 */}
              <TabsList variant="line">
                <TabsTrigger value="friends">Friends</TabsTrigger>
                <TabsTrigger value="communities">Communities</TabsTrigger>
                <TabsTrigger value="leaderboards">Leaderboards</TabsTrigger>
                <TabsTrigger value="matches">Matches</TabsTrigger>
                <TabsTrigger value="chats">Chats</TabsTrigger>
              </TabsList>

              <TabsContent value="friends">
                <Panel
                  eyebrow="Friends"
                  title="Relationship graph"
                  subtitle="Friend requests remain on Nakama native social APIs, but the UI is tuned for quick moderation."
                >
                  {/* Friends tab 把社交關係的三種狀態放在同一層：
                      accepted、inbound、outbound，方便直接在清單中完成處理。 */}
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">Accepted, inbound, and outbound states are shown together.</p>
                    <Dialog open={friendDialogOpen} onOpenChange={handleFriendDialogOpenChange}>
                      <DialogTrigger asChild>
                        <Button disabled={!loggedIn}>
                          <UserPlus className="size-4" />
                          Add friend
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Add friend by username</DialogTitle>
                          <DialogDescription>
                            The request will be sent through Nakama friend APIs in live mode.
                          </DialogDescription>
                        </DialogHeader>
                        <form className="space-y-4" onSubmit={(event) => void handleFriendSubmit(event)}>
                          {/* 這個輸入框雖然叫 by username，但實際上會先走模糊搜尋候選，
                              再由使用者確認真正要送邀請的目標。 */}
                          <Field
                            label="Username"
                            placeholder="輸入 username，支援模糊搜尋"
                            value={friendInviteUsername}
                            onChange={handleFriendInviteUsernameChange}
                          />
                          <div className="space-y-2">
                            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Candidate users</p>
                            <div className="rounded-2xl border border-border bg-background/70 p-2">
                              {friendInviteUserSearching ? (
                                <p className="px-2 py-1 text-sm text-muted-foreground">Searching users...</p>
                              ) : friendInviteUsername.trim().length < 2 ? (
                                <p className="px-2 py-1 text-sm text-muted-foreground">Type at least 2 characters to search.</p>
                              ) : friendInviteUserMatches.length ? (
                                <div className="space-y-2">
                                  {friendInviteUserMatches.map((candidate) => (
                                    <button
                                      className="flex w-full items-center justify-between rounded-xl border border-transparent px-3 py-2 text-left transition hover:border-border hover:bg-white/[0.04]"
                                      key={candidate.userId}
                                      onClick={() => setFriendInviteUsername(candidate.username)}
                                      type="button"
                                    >
                                      <div className="min-w-0">
                                        <p className="truncate font-medium text-white">
                                          {candidate.displayName || candidate.username}
                                        </p>
                                        <p className="truncate text-sm text-muted-foreground">@{candidate.username}</p>
                                      </div>
                                      <Badge variant="outline">Use</Badge>
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <p className="px-2 py-1 text-sm text-muted-foreground">No matching users found.</p>
                              )}
                            </div>
                          </div>
                          <DialogFooter>
                            <Button disabled={busy || !loggedIn} type="submit">
                              Send invite
                            </Button>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                  </div>

                  <div className="mb-4">
                    {/* 朋友搜尋是純前端過濾，不會額外打 Nakama。 */}
                    <Field
                      label="Search friends"
                      placeholder="Fuzzy search by name, username, or state"
                      value={existingFriendSearchQuery}
                      onChange={setExistingFriendSearchQuery}
                    />
                  </div>

                  <ScrollArea className="h-[26rem] rounded-2xl border border-border bg-background/70 p-1">
                    <div className="space-y-3 p-3">
                      <ListState
                        emptyLabel="No friend relationships yet."
                        items={filteredExistingFriends}
                        keyExtractor={(friend) => friend.id}
                        renderItem={(friend) => (
                          <Card className="border-border bg-white/[0.04] backdrop-blur-sm">
                            <CardContent className="flex items-center justify-between gap-3 px-4 py-4">
                              <div className="flex min-w-0 items-center gap-3">
                                <Avatar>
                                  <AvatarFallback>{initialsFromProfile(friend.displayName)}</AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-white">{friend.displayName}</p>
                                  <p className="truncate text-sm text-muted-foreground">@{friend.username}</p>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                {friend.state === "inbound" && (
                                  <Button disabled={busy} size="sm" onClick={() => void handleFriendAccept(friend.id)}>
                                    Accept
                                  </Button>
                                )}
                                {friend.state === "inbound" && (
                                  <Button
                                    disabled={busy}
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => void handleFriendReject(friend.id)}
                                  >
                                    Reject
                                  </Button>
                                )}
                                {friend.state === "outbound" && (
                                  <Button
                                    disabled={busy}
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => void handleFriendReject(friend.id)}
                                  >
                                    Cancel request
                                  </Button>
                                )}
                                {friend.state === "accepted" && (
                                  <Button
                                    disabled={busy}
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => void handleFriendRemove(friend.id)}
                                  >
                                    Remove friend
                                  </Button>
                                )}
                                <Badge variant="secondary">{friend.state}</Badge>
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      />
                    </div>
                  </ScrollArea>
                </Panel>
              </TabsContent>

              <TabsContent value="communities">
                <Panel
                  eyebrow="Communities"
                  title="Groups and guilds"
                  subtitle="Guild creation and approvals go through RPC. Public groups still use the native group API."
                >
                  {/* 這裡刻意把 group 與 guild 並排顯示，
                      讓使用者能直接感受到兩者在 join/approval 規則上的差異。 */}
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      Guilds are private by rule. Groups can remain open for lighter-weight coordination.
                    </p>
                    <Dialog open={communityDialogOpen} onOpenChange={setCommunityDialogOpen}>
                      <DialogTrigger asChild>
                        <Button disabled={!loggedIn}>
                          <Shield className="size-4" />
                          New community
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-lg">
                        <DialogHeader>
                          <DialogTitle>Create group or guild</DialogTitle>
                          <DialogDescription>
                            Guild creation uses server RPC so membership policy and naming rules stay authoritative.
                          </DialogDescription>
                        </DialogHeader>
                        <form className="space-y-4" onSubmit={(event) => void handleCommunitySubmit(event)}>
                          {/* kind 會決定後續走原生 group API 還是 authoritative guild RPC。 */}
                          <div className="grid gap-4 sm:grid-cols-2">
                            <Field
                              label="Name"
                              placeholder="Macro Hunters"
                              value={communityForm.name}
                              onChange={(value) => setCommunityForm((current) => ({ ...current, name: value }))}
                            />
                            <label className="space-y-2">
                              <span className="text-sm font-medium text-slate-300">Kind</span>
                              <Select
                                value={communityForm.kind}
                                onValueChange={(value) =>
                                  setCommunityForm((current) => ({
                                    ...current,
                                    kind: value as CommunityKind,
                                    open: value === "guild" ? false : current.open,
                                  }))
                                }
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select a kind" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="group">Group</SelectItem>
                                  <SelectItem value="guild">Guild</SelectItem>
                                </SelectContent>
                              </Select>
                            </label>
                          </div>
                          <label className="space-y-2">
                            <span className="text-sm font-medium text-slate-300">Description</span>
                            <Textarea
                              onChange={(event) =>
                                setCommunityForm((current) => ({ ...current, description: event.target.value }))
                              }
                              placeholder="Purpose, strategy style, and governance policy."
                              value={communityForm.description}
                            />
                          </label>
                          {communityForm.kind === "guild" ? (
                            // guild 的加入規則不在前端自由配置，而是由後端 join policy 管理。
                            <div className="rounded-2xl border border-border bg-background/80 px-4 py-3 text-sm text-slate-300">
                              Open join policy is not configurable for guilds. Guilds are always private and require
                              invite or approval.
                            </div>
                          ) : (
                            <label className="flex items-center gap-3 rounded-2xl border border-border bg-background/80 px-4 py-3 text-sm text-slate-300">
                              <input
                                checked={communityForm.open}
                                onChange={(event) =>
                                  setCommunityForm((current) => ({ ...current, open: event.target.checked }))
                                }
                                type="checkbox"
                              />
                              Open join policy
                            </label>
                          )}
                          <DialogFooter>
                            <Button disabled={!loggedIn || busy} type="submit">
                              {communityForm.kind === "guild" ? "Create guild" : "Create community"}
                            </Button>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                  </div>

                  <div className="mb-4">
                    {/* community 搜尋同樣只針對目前 snapshot 內的項目做模糊比對。 */}
                    <Field
                      label="Search communities"
                      placeholder="Fuzzy search by name, description, kind, or role"
                      value={communitySearch}
                      onChange={setCommunitySearch}
                    />
                  </div>

                  <ScrollArea className="h-[28rem] rounded-2xl border border-border bg-background/70 p-1">
                    <div className="space-y-3 p-3">
                      <ListState
                        emptyLabel="No groups or guilds available."
                        items={filteredCommunities}
                        keyExtractor={(community) => community.id}
                        renderItem={(community) => (
                          <CommunityCard
                            busy={busy}
                            community={community}
                            onApprove={handleGuildJoinApproval}
                            onJoin={handleCommunityJoin}
                            onLeave={handleGuildLeave}
                            onLeaveGroup={handleGroupLeave}
                            onReject={handleGuildJoinRejection}
                            onRequestJoin={handleGuildJoinRequest}
                          />
                        )}
                      />
                    </div>
                  </ScrollArea>
                </Panel>
              </TabsContent>

              <TabsContent value="leaderboards">
                <Panel
                  eyebrow="Rankings"
                  title="Leaderboard operations"
                  subtitle="Rankings are projected from completed authoritative finance matches."
                >
                  <p className="mb-5 text-sm text-muted-foreground">
                    Players cannot submit scores directly. Personal and guild rankings update after server settlement.
                  </p>
                  {error ? <Alert className="mb-4" variant="destructive">{error}</Alert> : null}

                  <div className="grid gap-4 xl:grid-cols-3">
                    <LeaderboardList
                      icon={<Trophy className="size-4" />}
                      items={snapshot?.leaderboards.global ?? []}
                      title="Global"
                      emptyLabel="No completed finance match has populated this board yet."
                    />
                    <LeaderboardList
                      icon={<Users className="size-4" />}
                      items={snapshot?.leaderboards.friends ?? []}
                      title="Friends"
                      emptyLabel="No friend records yet. Add friends and submit scores to see entries here."
                    />
                    <LeaderboardList
                      icon={<Activity className="size-4" />}
                      items={snapshot?.leaderboards.guild ?? []}
                      title="Guild Average"
                      emptyLabel="No guild average records yet. Join a guild and submit scores to generate this board."
                    />
                  </div>
                </Panel>
              </TabsContent>

              <TabsContent value="matches">
                <Panel
                  eyebrow="Relayed"
                  title="Practice match rooms"
                  subtitle="Nakama relays match state between clients. Final scoring should still go through server RPC."
                >
                  <div className="mb-4 flex justify-end">
                    <Button asChild variant="secondary">
                      <Link href="/matches">Open full arena</Link>
                    </Button>
                  </div>
                  <FinanceDuelMatchPanel disabled={busy || !loggedIn} snapshot={snapshot} />
                </Panel>
              </TabsContent>

              <TabsContent value="chats">
                <Panel
                  eyebrow="Realtime"
                  title="Direct and community chat"
                  subtitle="Accepted friends use DM channels. Groups and guilds use persistent Nakama group channels."
                >
                  {/* Dashboard 不直接處理 socket 細節；聊天相關狀態由 RealtimeChatPanel 內部管理。 */}
                  <RealtimeChatPanel disabled={busy || !loggedIn} snapshot={snapshot} />
                </Panel>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </main>
  );
}

function CommunityCard({
  community,
  busy,
  onJoin,
  onLeaveGroup,
  onRequestJoin,
  onApprove,
  onReject,
  onLeave,
}: {
  community: CommunityView;
  busy: boolean;
  onJoin: (communityId: string) => Promise<void>;
  onLeaveGroup: (communityId: string) => Promise<void>;
  onRequestJoin: (guildId: string) => Promise<void>;
  onApprove: (guildId: string, userId: string) => Promise<void>;
  onReject: (guildId: string, userId: string) => Promise<void>;
  onLeave: () => Promise<void>;
}) {
  // CommunityCard 是首頁 community 清單的統一表達層。
  // 它不自己決定權限，只根據上層已整理好的 CommunityView 顯示可執行動作。
  const badgeIcon = community.kind === "guild" ? <Shield className="size-3.5" /> : <Users className="size-3.5" />;

  return (
    <Card className="border-border bg-white/[0.04] backdrop-blur-sm">
      <CardContent className="px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarFallback>{initialsFromProfile(community.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate font-medium text-white">{community.name}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{community.description}</p>
              </div>
            </div>
          </div>
          <Badge className="gap-1.5 bg-[var(--signal-soft)] text-[var(--signal-strong)]">
            {badgeIcon}
            {community.kind}
          </Badge>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="secondary">{community.memberCount} members</Badge>
          <Badge variant="secondary">{community.role}</Badge>
          <Badge variant="secondary">{community.open ? "open" : "invite only"}</Badge>
        </div>

        {community.kind === "guild" ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {/* guild 走 authoritative detail / governance 頁；
                group 則只需要較輕量的 detail 與 join/leave 流程。 */}
            <Button asChild variant="outline">
              <Link href={`/guilds/${community.id}`}>View detail</Link>
            </Button>
            {(community.role === "owner" || community.role === "admin" || community.role === "member") && (
              <Button disabled={busy} variant="destructive" onClick={() => void onLeave()}>
                Leave guild
              </Button>
            )}
          </div>
        ) : null}

        {community.kind === "guild" && community.canRequestJoin ? (
          // guild 的加入不是直接 join，而是 request -> approve/reject 流程。
          <Button className="mt-4" disabled={busy} variant="secondary" onClick={() => void onRequestJoin(community.id)}>
            Request to join
          </Button>
        ) : null}

        {community.kind === "group" && community.canJoin ? (
          // 公開 group 可以直接 join，不需要額外治理核准。
          <Button className="mt-4" disabled={busy} variant="secondary" onClick={() => void onJoin(community.id)}>
            Join group
          </Button>
        ) : null}

        {community.kind === "group" && community.role !== "visitor" ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/communities/${community.id}`}>View detail</Link>
            </Button>
            <Button disabled={busy} variant="destructive" onClick={() => void onLeaveGroup(community.id)}>
              Leave group
            </Button>
          </div>
        ) : null}

        {community.pendingRequests.length ? (
          // 待審核申請只會出現在 owner/admin 視角的 guild 卡片上。
          <Card className="mt-4 border-border bg-muted/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Pending requests</CardTitle>
              <CardDescription>Visible to guild owner and admin.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {community.pendingRequests.map((request) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.05] px-3 py-3 backdrop-blur-sm"
                  key={`${request.guildId}-${request.userId}`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">@{request.username}</p>
                    <p className="truncate text-xs uppercase tracking-[0.14em] text-muted-foreground">{request.userId}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button disabled={busy} size="sm" onClick={() => void onApprove(community.id, request.userId)}>
                      Approve
                    </Button>
                    <Button
                      disabled={busy}
                      size="sm"
                      variant="destructive"
                      onClick={() => void onReject(community.id, request.userId)}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Panel({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-white/10 bg-[var(--panel)] shadow-[var(--shadow-soft)] backdrop-blur-xl">
      <CardHeader>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--signal-strong)]">{eyebrow}</p>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function MetricCard({
  icon,
  label,
  value,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <Card className="border-border bg-white/[0.05] backdrop-blur-sm">
      <CardContent className="px-4 py-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{label}</p>
          <div className="text-[var(--signal-strong)]">{icon}</div>
        </div>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-white">{value}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: React.HTMLInputTypeAttribute;
}) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-slate-300">{label}</span>
      <Input onChange={(event) => onChange(event.target.value)} placeholder={placeholder} type={type} value={value} />
    </label>
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

function ListState<T>({
  items,
  renderItem,
  emptyLabel,
  keyExtractor,
}: {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  emptyLabel: string;
  keyExtractor: (item: T, index: number) => string;
}) {
  if (!items.length) {
    return <Alert>{emptyLabel}</Alert>;
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={keyExtractor(item, index)}>{renderItem(item)}</div>
      ))}
    </div>
  );
}

function LeaderboardList({
  title,
  items,
  emptyLabel,
  icon,
}: {
  title: string;
  items: Array<{ ownerId: string; username: string; score: number; rank: number }>;
  emptyLabel: string;
  icon: React.ReactNode;
}) {
  // 排行榜資料已在 service.ts 被整理成固定 view model。
  // 這裡只負責呈現 rank / username / score，不在 UI 端重新排序，避免和 Nakama 回傳順序不一致。
  return (
    <Card className="border-border bg-white/[0.04] backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="text-[var(--signal-strong)]">{icon}</div>
            <CardTitle className="text-sm uppercase tracking-[0.18em]">{title}</CardTitle>
          </div>
          <span className="text-xs font-medium text-muted-foreground">{items.length} entries</span>
        </div>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <ScrollArea className="h-72 rounded-xl">
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  className="grid grid-cols-[3rem_1fr_auto] items-center gap-3 rounded-2xl bg-muted/40 px-3 py-3"
                  key={`${title}-${item.ownerId}`}
                >
                  <span className="text-sm font-semibold text-muted-foreground">#{item.rank}</span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{item.username}</p>
                    <p className="truncate text-xs uppercase tracking-[0.16em] text-muted-foreground">{item.ownerId}</p>
                  </div>
                  <span className="text-sm font-semibold text-[var(--primary)]">{item.score.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <p className="text-sm leading-7 text-muted-foreground">{emptyLabel}</p>
        )}
      </CardContent>
    </Card>
  );
}

function totalPendingRequests(communities: CommunityView[]) {
  // Dashboard header 使用的彙總數字，將所有 community 的待審核申請加總。
  return communities.reduce((sum, community) => sum + community.pendingRequests.length, 0);
}

function initialsFromProfile(value: string) {
  // Avatar fallback：從 username 或 display name 取前兩段字首，避免空頭像造成列表辨識困難。
  return value
    .split(/[\s-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function normalizeError(error: unknown) {
  // service 層可能丟 Error、字串或未知 Response 解析結果，UI 統一轉成可顯示文字。
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Unexpected runtime error.";
}

function fuzzyMatch(values: Array<string | undefined>, query: string) {
  // 模糊搜尋支援兩種情境：
  // 1. 一般 includes，例如 "fin" 可以命中 "finance guild"。
  // 2. 子序列比對，例如 "fg" 可以命中 "finance guild"，方便快速搜尋好友 / group / guild。
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return true;

  return values.some((value) => {
    const candidate = normalizeSearch(value ?? "");
    if (!candidate) return false;
    if (candidate.includes(normalizedQuery)) return true;

    let pointer = 0;
    for (const char of candidate) {
      if (char === normalizedQuery[pointer]) {
        pointer += 1;
        if (pointer === normalizedQuery.length) return true;
      }
    }

    return false;
  });
}

function normalizeSearch(value: string) {
  // 搜尋前先小寫化並移除空白，讓使用者不必精準輸入大小寫或完整空格。
  return value.trim().toLowerCase().replace(/\s+/g, "");
}
