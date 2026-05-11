import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Video, Sparkles, Users, FileText, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Henosis Meet — Video Meetings with AI Notes" },
      {
        name: "description",
        content:
          "Henosis NGO's virtual conferencing platform. Free video meetings powered by Jitsi with live AI transcription and smart meeting notes.",
      },
      { property: "og:title", content: "Henosis Meet — Video Meetings with AI Notes" },
      { property: "og:description", content: "Free video meetings with live AI transcription for the Henosis NGO." },
    ],
  }),
  component: Landing,
});

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function randomRoom() {
  const adjectives = ["bright", "kind", "open", "swift", "warm", "bold", "calm", "wise"];
  const nouns = ["harbor", "summit", "circle", "horizon", "village", "council", "river", "garden"];
  const a = adjectives[Math.floor(Math.random() * adjectives.length)];
  const n = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(100 + Math.random() * 900);
  return `henosis-${a}-${n}-${num}`;
}

function Landing() {
  const navigate = useNavigate();
  const [roomInput, setRoomInput] = useState("");
  const [activeRooms, setActiveRooms] = useState<{ roomId: string; count: number }[]>([]);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase.channel("active-meetings");
      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel!.presenceState<{ roomId: string }>();
          const counts: Record<string, number> = {};
          Object.values(state)
            .flat()
            .forEach((p) => {
              if (p.roomId) counts[p.roomId] = (counts[p.roomId] ?? 0) + 1;
            });
          setActiveRooms(
            Object.entries(counts).map(([roomId, count]) => ({ roomId, count })),
          );
        })
        .subscribe();
    } catch {
      /* Supabase not available */
    }
    return () => {
      try {
        if (channel) supabase.removeChannel(channel);
      } catch {
        /* ignore */
      }
    };
  }, []);

  const start = () => {
    const room = roomInput.trim() ? slugify(roomInput) : randomRoom();
    navigate({ to: "/meeting/$roomId", params: { roomId: room } });
  };

  const join = () => {
    if (!roomInput.trim()) return;
    navigate({ to: "/meeting/$roomId", params: { roomId: slugify(roomInput) } });
  };

  return (
    <div className="min-h-screen" style={{ background: "var(--gradient-soft)" }}>
      {/* Header */}
      <header className="container mx-auto flex items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl text-primary-foreground"
            style={{ background: "var(--gradient-hero)" }}
          >
            <Video className="h-5 w-5" />
          </div>
          <span className="font-display text-lg font-semibold tracking-tight">Henosis Meet</span>
        </div>
        <span className="hidden text-sm text-muted-foreground sm:block">
          For the Henosis NGO community
        </span>
      </header>

      {/* Hero */}
      <section className="container mx-auto px-6 pb-16 pt-10 sm:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            Live AI transcription · Smart meeting notes
          </div>
          <h1 className="text-balance text-5xl font-bold leading-tight tracking-tight sm:text-6xl">
            Meet, talk,{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--gradient-hero)" }}
            >
              and never lose a moment.
            </span>
          </h1>
          <p className="mt-6 text-balance text-lg text-muted-foreground">
            Secure video meetings for the Henosis NGO. We transcribe in real time and turn every
            conversation into clear, structured notes — so your team can focus on the mission.
          </p>

          {/* CTA */}
          <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-elevated)]">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value)}
                placeholder="Enter meeting name or leave empty"
                className="h-12 border-0 bg-transparent text-base shadow-none focus-visible:ring-0"
                onKeyDown={(e) => e.key === "Enter" && start()}
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="h-12 flex-1 sm:flex-none"
                  onClick={join}
                  disabled={!roomInput.trim()}
                >
                  Join
                </Button>
                <Button
                  className="h-12 flex-1 gap-2 px-6 sm:flex-none"
                  style={{ background: "var(--gradient-hero)" }}
                  onClick={start}
                >
                  New meeting
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            No sign-up needed · Share the link · Up to 50 participants
          </p>

          {activeRooms.length > 0 && (
            <div className="mx-auto mt-6 max-w-xl">
              <p className="mb-3 text-sm font-medium text-muted-foreground">
                Meetings in progress
              </p>
              <div className="space-y-2">
                {activeRooms.map(({ roomId, count }) => (
                  <div
                    key={roomId}
                    className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                      <div className="text-left">
                        <p className="text-sm font-medium">{roomId}</p>
                        <p className="text-xs text-muted-foreground">
                          {count} participant{count !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        navigate({ to: "/meeting/$roomId", params: { roomId } })
                      }
                    >
                      Join
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Features */}
      <section className="container mx-auto grid gap-4 px-6 pb-24 sm:grid-cols-3">
        {[
          {
            icon: Video,
            title: "HD video, instantly",
            body: "Powered by open-source Jitsi. Click and you're in — no installs, no accounts.",
          },
          {
            icon: Sparkles,
            title: "Live AI transcription",
            body: "Speech-to-text in your browser captures every word as the meeting happens.",
          },
          {
            icon: FileText,
            title: "Smart meeting notes",
            body: "One click turns the transcript into a summary, decisions, and action items.",
          },
        ].map((f) => (
          <div
            key={f.title}
            className="rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-primary">
              <f.icon className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-border">
        <div className="container mx-auto flex flex-col items-center justify-between gap-2 px-6 py-6 text-sm text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Built for Henosis NGO
          </div>
          <div>© {new Date().getFullYear()} Henosis Meet</div>
        </div>
      </footer>
    </div>
  );
}
