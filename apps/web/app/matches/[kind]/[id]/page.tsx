import { MatchArenaClient } from "@/components/match-arena-client";
import type { GroupKind } from "@/lib/nakama/service";

export default async function CommunityMatchPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  const communityKind: GroupKind = kind === "guild" ? "guild" : "group";
  return <MatchArenaClient communityId={id} communityKind={communityKind} />;
}
