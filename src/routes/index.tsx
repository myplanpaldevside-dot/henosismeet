import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Video, Sparkles, FileText, ArrowRight, Loader2, Users } from "lucide-react";
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
  const [starting, setStarting] = useState(false);
  const startMeeting = useServerFn(createMeeting);

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
          setActiveRooms(Object.entries(counts).map(([roomId, count]) => ({ roomId, count })));
        })
        .subscribe();
    } catch { /* Supabase not available */ }
    return () => {
      try { if (channel) supabase.removeChannel(channel); } catch { /* ignore */ }
    };
  }, []);

  const start = async () => {
    const slugified = roomInput.trim() ? slugify(roomInput) : null;
    const room = slugified || randomRoom();
    setStarting(true);
    try {
      const { creatorToken } = await startMeeting({ data: { roomId: room } });
      localStorage.setItem(`henosis_creator_${room}`, creatorToken);
    } catch { /* join as guest */ } finally {
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
    <div style={{ background: "var(--gradient-dark-hero)" }} className="min-h-screen text-white">

      {/* ── Minimal nav ─────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 z-50 w-full">
        <div
          className="border-b border-white/[0.06]"
          style={{ background: "oklch(0.08 0.04 295 / 0.8)", backdropFilter: "blur(20px)" }}
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-2.5">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ background: "var(--gradient-hero)" }}
              >
                <Video className="h-4 w-4 text-white" />
              </div>
              <span className="font-display text-[15px] font-semibold tracking-tight">Henosis Meet</span>
            </div>
            <span className="hidden text-xs font-medium tracking-widest text-white/30 sm:block" style={{ letterSpacing: "0.14em" }}>
              FOR HENOSIS NGO
            </span>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="flex min-h-screen flex-col items-center justify-center px-6 pb-16 pt-28 text-center">

        {/* Org label */}
        <p
          className="ui-fade-up mb-7 text-[11px] font-semibold tracking-[0.22em] text-white/35"
          style={{ animationDelay: "0ms" }}
        >
          HENOSIS NGO
        </p>

        {/* Headline */}
        <h1
          className="ui-fade-up mx-auto max-w-4xl font-display font-extrabold leading-[1.0] tracking-[-0.04em] text-white"
          style={{
            fontSize: "clamp(3rem, 8.5vw, 7.5rem)",
            animationDelay: "120ms",
          }}
        >
          Meet, talk, and{" "}
          <br className="hidden sm:block" />
          <span
            className="animate-gradient-pan bg-clip-text text-transparent"
            style={{ backgroundImage: "var(--gradient-hero)" }}
          >
            never lose a moment.
          </span>
        </h1>

        {/* Subtitle */}
        <p
          className="ui-fade-up mx-auto mt-8 max-w-md text-[17px] leading-relaxed text-white/45"
          style={{ animationDelay: "240ms" }}
        >
          Secure video meetings with live AI transcription and smart notes — built for the Henosis community.
        </p>

        {/* CTA */}
        <div
          className="ui-fade-up mt-10 w-full max-w-xl"
          style={{ animationDelay: "360ms" }}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              placeholder="Room name, or leave empty for a random one"
              className="h-13 flex-1 rounded-xl border border-white/10 bg-white/[0.05] px-4 text-sm text-white placeholder:text-white/25 outline-none transition-colors focus:border-white/20 focus:bg-white/[0.08]"
              style={{ height: "52px" }}
              onKeyDown={(e) => e.key === "Enter" && start()}
            />
            <div className="flex gap-2">
              <button
                onClick={join}
                disabled={!roomInput.trim()}
                className="h-[52px] rounded-xl border border-white/15 bg-white/[0.06] px-5 text-sm font-medium text-white/80 transition-all hover:bg-white/[0.12] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Join
              </button>
              <button
                onClick={start}
                disabled={starting}
                className="flex h-[52px] items-center gap-2 rounded-xl px-6 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
                style={{ background: "var(--gradient-hero)" }}
              >
                {starting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <><span>New meeting</span><ArrowRight className="h-4 w-4" /></>
                )}
              </button>
            </div>
          </div>
          <p className="mt-3.5 text-[12px] text-white/25">
            No sign-up needed · Share the link · Up to 50 participants
          </p>
        </div>

        {/* Live meetings */}
        {activeRooms.length > 0 && (
          <div
            className="ui-fade-up mt-16 w-full max-w-xl"
            style={{ animationDelay: "480ms" }}
          >
            <div className="mb-3 flex items-center justify-between px-1">
              <p className="text-[11px] font-semibold tracking-[0.18em] text-white/30">LIVE NOW</p>
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-green-400">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                </span>
                {activeRooms.length} active
              </span>
            </div>
            <div className="space-y-1.5">
              {activeRooms.map(({ roomId, count }) => (
                <div
                  key={roomId}
                  className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.04] px-4 py-3.5 transition-colors hover:bg-white/[0.07]"
                >
                  <div className="text-left">
                    <p className="text-sm font-semibold">{roomId}</p>
                    <p className="text-xs text-white/40">
                      {count} participant{count !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => navigate({ to: "/meeting/$roomId", params: { roomId } })}
                    className="rounded-lg border border-white/15 bg-white/[0.08] px-4 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.15]"
                  >
                    Join
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Features ────────────────────────────────────────────────────────── */}
      <section
        className="border-t border-white/[0.06]"
        style={{ background: "oklch(0.11 0.04 295)" }}
      >
        <div className="mx-auto max-w-6xl px-6 py-28">

          <div className="mb-20 text-center">
            <p className="mb-4 text-[11px] font-semibold tracking-[0.22em] text-white/30">
              WHAT YOU GET
            </p>
            <h2
              className="font-display font-bold text-white"
              style={{ fontSize: "clamp(1.75rem, 4vw, 3rem)" }}
            >
              Everything your team needs
            </h2>
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            {[
              {
                icon: Video,
                title: "HD video, instantly",
                body: "Powered by open-source Jitsi. Click and you're in, no installs, no accounts needed.",
              },
              {
                icon: Sparkles,
                title: "Live AI transcription",
                body: "Speech-to-text in your browser captures every word from every participant as it happens.",
              },
              {
                icon: FileText,
                title: "Smart meeting notes",
                body: "One click turns the full transcript into a clean summary, decisions, and action items.",
              },
            ].map((f, i) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-white/[0.07] p-9 transition-all duration-500 hover:-translate-y-1.5 hover:border-white/[0.14]"
                style={{
                  background: "oklch(0.13 0.04 295)",
                  animationDelay: `${i * 80}ms`,
                }}
              >
                <div className="mb-7 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.07] transition-all duration-300 group-hover:bg-white/[0.12]">
                  <f.icon className="h-5 w-5 text-white/70 transition-colors group-hover:text-white" />
                </div>
                <h3 className="mb-3 text-lg font-bold text-white">{f.title}</h3>
                <p className="text-sm leading-relaxed text-white/45">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer
        className="border-t border-white/[0.06]"
        style={{ background: "oklch(0.08 0.04 295)" }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <div className="flex items-center gap-2 text-sm text-white/30">
            <Users className="h-4 w-4" />
            Built for Henosis NGO
          </div>
          <p className="text-sm text-white/20">&copy; {new Date().getFullYear()} Henosis Meet</p>
        </div>
      </footer>
    </div>
  );
}
