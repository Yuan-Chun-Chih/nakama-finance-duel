import { CommunityDetailClient } from "@/components/community-detail-client";

export default async function CommunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CommunityDetailClient communityId={id} />;
}
