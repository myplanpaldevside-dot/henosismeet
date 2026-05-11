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
      { title: "Henosis Meet | Video Meetings with AI Notes" },
      {
        name: "description",
        content:
          "Henosis NGO's virtual conferencing platform. Free video meetings powered by Jitsi with live AI transcription and smart meeting notes.",
      },
      { property: "og:title", content: "Henosis Meet | Video Meetings with AI Notes" },
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
    <div className="min-h-screen bg-background">
      {/* Fixed nav */}
      <header
        className="fixed top-0 z-50 w-full border-b border-white/8 backdrop-blur-xl"
        style={{ background: "oklch(0.10 0.04 295 / 0.85)" }}
      >
        <div className="container mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
              style={{ background: "var(--gradient-hero)" }}
            >
              <Video className="h-4 w-4" />
            </div>
            <span className="font-display text-base font-semibold tracking-tight text-white">Henosis Meet</span>
          </div>
          <span className="hidden text-sm text-white/50 sm:block">For the Henosis NGO community</span>
        </div>
      </header>

      {/* Dark hero */}
      <section
        className="relative flex min-h-screen items-center justify-center overflow-hidden pt-20"
        style={{ background: "var(--gradient-dark-hero)" }}
      >
        {/* Subtle radial glow behind headline */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: "radial-gradient(ellipse 80% 50% at 50% 40%, oklch(0.42 0.18 295 / 0.18) 0%, transparent 70%)",
          }}
        />

        <div className="container relative mx-auto px-6 pb-24 pt-16 text-center">
          {/* Badge */}
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/70 backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            Live AI transcription · Smart meeting notes
          </div>

          {/* Headline */}
          <h1 className="mx-auto max-w-4xl text-balance text-5xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-7xl lg:text-8xl">
            Meet, talk, and{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--gradient-hero)" }}
            >
              never lose a moment.
            </span>
          </h1>

          <p className="mx-auto mt-7 max-w-xl text-balance text-lg leading-relaxed text-white/55">
            Secure video meetings for the Henosis NGO. We transcribe in real time and turn every
            conversation into clear, structured notes.
          </p>

          {/* CTA box */}
          <div className="mx-auto mt-10 max-w-lg">
            <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 p-2 backdrop-blur-sm sm:flex-row">
              <Input
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value)}
                placeholder="Enter a room name, or leave empty"
                className="h-12 border-0 bg-transparent text-sm text-white shadow-none placeholder:text-white/30 focus-visible:ring-0"
                onKeyDown={(e) => e.key === "Enter" && start()}
              />
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  className="h-12 flex-1 border-white/15 bg-white/8 text-white hover:bg-white/15 sm:flex-none sm:px-5"
                  onClick={join}
                  disabled={!roomInput.trim()}
                >
                  Join
                </Button>
                <Button
                  className="h-12 flex-1 gap-2 px-6 text-white shadow-lg sm:flex-none"
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
            <p className="mt-3 text-xs text-white/35">
              No sign-up needed · Share the link · Up to 50 participants
            </p>
          </div>

          {/* Live meetings */}
          {activeRooms.length > 0 && (
            <div className="mx-auto mt-14 max-w-lg">
              <div className="mb-4 flex items-center justify-between px-1">
                <p className="text-xs font-semibold uppercase tracking-widest text-white/40">
                  Meetings in progress
                </p>
                <span className="flex items-center gap-1.5 text-xs font-medium text-green-400">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                  </span>
                  {activeRooms.length} active
                </span>
              </div>
              <div className="grid gap-2">
                {activeRooms.map(({ roomId, count }) => (
                  <div
                    key={roomId}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                  >
                    <div className="text-left">
                      <p className="text-sm font-semibold text-white">{roomId}</p>
                      <p className="text-xs text-white/45">
                        {count} participant{count !== 1 ? "s" : ""} joined
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-white/15 bg-white/8 text-white hover:bg-white/15"
                      onClick={() => navigate({ to: "/meeting/$roomId", params: { roomId } })}
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
      <section className="container mx-auto grid gap-4 px-6 py-24 sm:grid-cols-3">
        {[
          {
            icon: Video,
            title: "HD video, instantly",
            body: "Powered by open-source Jitsi. Click and you're in, no installs, no accounts.",
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
            className="group rounded-2xl border border-border bg-card p-8 transition-all duration-300 hover:-translate-y-1 hover:border-primary/25 hover:shadow-[var(--shadow-elevated)]"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <f.icon className="h-5 w-5" />
            </div>
            <h3 className="text-xl font-bold tracking-tight">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
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
