import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Video, Sparkles, Users, FileText, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { createMeeting } from "@/lib/jaas";

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
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
  return slug || null;
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

  const [starting, setStarting] = useState(false);
  const startMeeting = useServerFn(createMeeting);

  const start = async () => {
    const slugified = roomInput.trim() ? slugify(roomInput) : null;
    const room = slugified || randomRoom();
    setStarting(true);
    try {
      const { creatorToken } = await startMeeting({ data: { roomId: room } });
      localStorage.setItem(`henosis_creator_${room}`, creatorToken);
    } catch {
      // If token generation fails, still navigate — user joins as guest
    } finally {
      setStarting(false);
    }
    navigate({ to: "/meeting/$roomId", params: { roomId: room } });
  };

  const join = () => {
    if (!roomInput.trim()) return;
    const room = slugify(roomInput);
    if (!room) return;
    navigate({ to: "/meeting/$roomId", params: { roomId: room } });
  };

  return (
    <div className="min-h-screen selection:bg-primary/10" style={{ background: "var(--gradient-soft)" }}>
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
        <div className="hidden items-center gap-4 sm:flex">
          <span className="text-sm text-muted-foreground">
            For the Henosis NGO community
          </span>
          <div className="h-4 w-px bg-border" />
          <Button variant="ghost" size="sm" className="text-xs font-medium">Documentation</Button>
        </div>
      </header>

      {/* Hero */}
      <section className="container mx-auto px-6 pb-16 pt-10 sm:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-4 py-1.5 text-xs font-medium text-accent shadow-sm backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            Live AI transcription · Smart meeting notes
          </div>
          <h1 className="text-balance text-5xl font-extrabold leading-[1.1] tracking-tight sm:text-7xl">
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--gradient-hero)" }}
            >
              and never lose a moment.
            </span>
          </h1>
          <p className="mx-auto mt-8 max-w-2xl text-balance text-lg leading-relaxed text-muted-foreground">
            Secure video meetings for the Henosis NGO. We transcribe in real time and turn every
            conversation into clear, structured notes — so your team can focus on the mission.
          </p>

          {/* CTA */}
          <div className="group mx-auto mt-12 max-w-xl rounded-2xl border border-border bg-card/50 p-3 shadow-[var(--shadow-elevated)] transition-all duration-300 focus-within:border-primary/30 focus-within:ring-4 focus-within:ring-primary/5 backdrop-blur-xl">
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
                  className="h-12 flex-1 border-border/50 bg-background/50 sm:flex-none"
                  onClick={join}
                  disabled={!roomInput.trim()}
                >
                  Join
                </Button>
                <Button
                  className="h-12 flex-1 gap-2 px-6 shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98] sm:flex-none"
                  style={{ background: "var(--gradient-hero)" }}
                  onClick={start}
                  disabled={starting}
                >
                  {starting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>New meeting <ArrowRight className="h-4 w-4" /></>
                  )}
                </Button>
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            No sign-up needed <span className="mx-2 opacity-30">•</span> Share the link <span className="mx-2 opacity-30">•</span> Up to 50 participants
          </p>

          {activeRooms.length > 0 && (
            <div className="mx-auto mt-12 max-w-xl">
              <div className="mb-4 flex items-center justify-between px-1">
                <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/80">
                  Live Meetings
                </p>
                <span className="flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
                  </span>
                  {activeRooms.length} active
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-1">
                {activeRooms.map(({ roomId, count }) => (
                  <div
                    key={roomId}
                    className="flex items-center justify-between rounded-xl border border-border bg-card/40 p-4 shadow-sm transition-colors hover:bg-card/60"
                  >
                    <div className="flex items-center gap-3">
                      <div className="text-left">
                        <p className="text-sm font-bold tracking-tight">{roomId}</p>
                        <p className="text-xs text-muted-foreground font-medium">{count} participant{count !== 1 ? "s" : ""} joined</p>
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
            className="group rounded-2xl border border-border bg-card/50 p-8 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/20 hover:shadow-xl hover:shadow-primary/5 backdrop-blur-sm"
          >
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <f.icon className="h-5 w-5" />
            </div>
            <h3 className="text-xl font-bold tracking-tight">{f.title}</h3>
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
