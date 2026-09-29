import { GuildDetailClient } from "@/components/guild-detail-client";

export default async function GuildDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <GuildDetailClient guildId={id} />;
}
