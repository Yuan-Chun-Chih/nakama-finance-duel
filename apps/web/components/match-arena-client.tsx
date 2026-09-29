'use client';

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Swords } from "lucide-react";
import { bootstrapPhaseOne, fetchCommunityDetail, type DashboardSnapshot, type GroupKind } from "@/lib/nakama/service";
import { FinanceDuelMatchPanel } from "@/components/finance-duel-match-panel";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function MatchArenaClient({
  communityId,
  communityKind,
}: {
  communityId?: string;
  communityKind?: GroupKind;
}) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [communityName, setCommunityName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [duelPresentation, setDuelPresentation] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadArena() {
      setLoading(true);
      setError(null);
      try {
        const nextSnapshot = await bootstrapPhaseOne();
        if (cancelled) return;
        setSnapshot(nextSnapshot);

        if (communityId && communityKind) {
          const detail = await fetchCommunityDetail(communityId);
          if (cancelled) return;
          setCommunityName(detail.community.name);
        }
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load match arena.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadArena();

    return () => {
      cancelled = true;
    };
  }, [communityId, communityKind, loadRevision]);

  const communityContext = useMemo(() => {
    if (!communityId || !communityKind) {
      return undefined;
    }
    return {
      id: communityId,
      kind: communityKind,
      name: communityName || `${communityKind} match arena`,
    };
  }, [communityId, communityKind, communityName]);

  return (
    <main
      className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(45,212,191,0.16),transparent_34rem),linear-gradient(135deg,#020617_0%,#0f172a_48%,#111827_100%)] px-3 py-4 sm:px-6 lg:px-8"
      aria-busy={loading}
    >
      <div className="mx-auto flex max-w-[118rem] flex-col gap-5">
        <Card className="border-white/10 bg-black/30 shadow-[var(--shadow-soft)] backdrop-blur-xl">
          <CardContent
            className={`flex flex-wrap items-center justify-between gap-4 px-5 ${duelPresentation ? "py-2.5" : "py-4"}`}
          >
            <div className={duelPresentation ? "" : "space-y-2"}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-[var(--signal-soft)] text-[var(--signal-strong)]">
                  <Swords className="size-3.5" />
                  Match Arena
                </Badge>
                <Badge variant="outline">{communityContext ? `${communityContext.kind}: ${communityContext.name}` : "Global practice"}</Badge>
                {loading ? <Badge variant="secondary">loading</Badge> : null}
              </div>
              {!duelPresentation ? (
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                    Trading duel workspace
                  </h1>
                  <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                    Five-minute BTC duel with server-authoritative ready state,
                    orders, portfolios, NAV settlement and live snapshots.
                  </p>
                </div>
              ) : null}
            </div>
            <Button asChild variant="outline">
              <Link href={communityContext ? `/communities/${communityContext.id}` : "/"}>
                <ArrowLeft className="size-4" />
                Back
              </Link>
            </Button>
          </CardContent>
        </Card>

        {error ? (
          <Alert
            variant="destructive"
            className="flex items-center justify-between gap-3"
          >
            <span>{error}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setLoadRevision((current) => current + 1)}
            >
              Retry
            </Button>
          </Alert>
        ) : null}

        <FinanceDuelMatchPanel
          disabled={loading || Boolean(error)}
          onDuelPresentationChange={setDuelPresentation}
          snapshot={snapshot}
        />
      </div>
    </main>
  );
}
