import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Mic,
  MicOff,
  Sparkles,
  Copy,
  FileText,
  Loader2,
  Video,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { summarizeMeeting } from "@/lib/ai.functions";
import { getJaasToken } from "@/lib/jaas";
import { supabase } from "@/integrations/supabase/client";
import React from "react";

export const Route = createFileRoute("/meeting/$roomId")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.roomId} | Henosis Meet` },
      { name: "description", content: "Join the Henosis Meet video call. No sign-up required." },
      { property: "og:title", content: `Join "${params.roomId}" on Henosis Meet` },
      {
        property: "og:description",
        content: "Tap the link to join this Henosis NGO video meeting. No account needed.",
      },
    ],
  }),
  component: MeetingRoom,
});

// --- Web Speech API typing ---
type SRConstructor = new () => SpeechRecognition;
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: {
    length: number;
    [i: number]: { isFinal: boolean; [j: number]: { transcript: string } };
  };
}

// --- Jitsi External API typing ---
type JitsiAPI = {
  dispose: () => void;
  addListener: (event: string, cb: (...args: unknown[]) => void) => void;
  executeCommand: (cmd: string, ...args: unknown[]) => void;
};
type JitsiConstructor = new (domain: string, options: Record<string, unknown>) => JitsiAPI;

function loadJitsiScript(): Promise<JitsiConstructor> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { JitsiMeetExternalAPI?: JitsiConstructor };
    if (w.JitsiMeetExternalAPI) return resolve(w.JitsiMeetExternalAPI);
    const existing = document.getElementById("jitsi-external-api") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => {
        const ww = window as unknown as { JitsiMeetExternalAPI?: JitsiConstructor };
        ww.JitsiMeetExternalAPI
          ? resolve(ww.JitsiMeetExternalAPI)
          : reject(new Error("Jitsi failed to load"));
      });
      return;
    }
    const s = document.createElement("script");
    s.id = "jitsi-external-api";
    s.src = "https://8x8.vc/libs/external_api.min.js";
    s.async = true;
    s.onload = () => {
      const ww = window as unknown as { JitsiMeetExternalAPI?: JitsiConstructor };
      ww.JitsiMeetExternalAPI
        ? resolve(ww.JitsiMeetExternalAPI)
        : reject(new Error("Jitsi failed to load"));
    };
    s.onerror = () => reject(new Error("Could not load Jitsi script"));
    document.body.appendChild(s);
  });
}

function MeetingRoom() {
  const { roomId } = Route.useParams();
  const navigate = useNavigate();
  const jitsiContainer = useRef<HTMLDivElement>(null);
  const apiRef = useRef<JitsiAPI | null>(null);

  // Is this user the meeting creator? Checked once on mount.
  const isModerator = useRef(!!localStorage.getItem(`henosis_creator_${roomId}`)).current;

  const [displayName, setDisplayName] = useState("");
  const [joined, setJoined] = useState(false);
  const [loadingCall, setLoadingCall] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [joiningCall, setJoiningCall] = useState(false);
  const [jaasToken, setJaasToken] = useState<string | null>(null);
  const [jaasRoomName, setJaasRoomName] = useState("");

  // Transcription state
  const [supported, setSupported] = useState(true);
  const [globalListening, setGlobalListening] = useState(false);
  const [transcript, setTranscript] = useState(""); // moderator only: combined final transcript
  const [interimMap, setInterimMap] = useState<Record<string, string>>({}); // speaker → interim

  const [notes, setNotes] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const globalListeningRef = useRef(false);
  const displayNameRef = useRef(displayName);

  const summarize = useServerFn(summarizeMeeting);
  const getToken = useServerFn(getJaasToken);

  // Keep refs in sync
  useEffect(() => { globalListeningRef.current = globalListening; }, [globalListening]);
  useEffect(() => { displayNameRef.current = displayName; }, [displayName]);

  // Restore stored name
  useEffect(() => {
    const stored = localStorage.getItem("henosis_display_name");
    if (stored) setDisplayName(stored);
  }, []);

  // Speech recognition setup — onresult broadcasts to Supabase so ALL speakers
  // contribute to the moderator's transcript
  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: SRConstructor;
      webkitSpeechRecognition?: SRConstructor;
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let finalChunk = "";
      let interimChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript;
        if (r.isFinal) finalChunk += text + " ";
        else interimChunk += text;
      }
      const ch = transcriptChannelRef.current;
      const speaker = displayNameRef.current || "Guest";
      if (finalChunk && ch) {
        ch.send({
          type: "broadcast",
          event: "transcript",
          payload: { speaker, text: finalChunk, final: true },
        });
      }
      if (ch) {
        ch.send({
          type: "broadcast",
          event: "transcript",
          payload: { speaker, text: interimChunk, final: false },
        });
      }
    };
    rec.onerror = (e) => console.error("Speech recognition error", e);
    rec.onend = () => {
      if (recognitionRef.current && globalListeningRef.current) {
        try { rec.start(); } catch { /* ignore */ }
      }
    };
    recognitionRef.current = rec;
    return () => {
      try { rec.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    };
  }, []);

  // Supabase transcription channel — coordinates start/stop and collects all speakers
  useEffect(() => {
    if (!joined) return;
    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      ch = supabase.channel(`transcription:${roomId}`);

      // All participants: listen for moderator's start/stop commands
      ch.on("broadcast", { event: "control" }, ({ payload }) => {
        const action = (payload as { action: string }).action;
        if (action === "start") {
          setGlobalListening(true);
          try { recognitionRef.current?.start(); } catch { /* ignore */ }
          if (!isModerator) toast.success("Host started recording. Your mic is being transcribed.");
        } else {
          setGlobalListening(false);
          try { recognitionRef.current?.stop(); } catch { /* ignore */ }
          if (!isModerator) toast("Recording stopped");
        }
      });

      // Moderator only: receive transcript chunks from all participants
      if (isModerator) {
        ch.on("broadcast", { event: "transcript" }, ({ payload }) => {
          const { speaker, text, final } = payload as {
            speaker: string;
            text: string;
            final: boolean;
          };
          if (final) {
            if (text.trim()) setTranscript((prev) => prev + `${speaker}: ${text}\n`);
            setInterimMap((prev) => {
              const next = { ...prev };
              delete next[speaker];
              return next;
            });
          } else {
            setInterimMap((prev) => ({ ...prev, [speaker]: text }));
          }
        });
      }

      ch.subscribe();
      transcriptChannelRef.current = ch;
    } catch {
      /* Supabase not available */
    }
    return () => {
      try {
        if (ch) supabase.removeChannel(ch);
      } catch { /* ignore */ }
      transcriptChannelRef.current = null;
    };
  }, [joined, roomId, isModerator]);

  // Supabase presence — landing page sees this meeting as active
  useEffect(() => {
    if (!joined) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase.channel("active-meetings");
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") await channel!.track({ roomId });
      });
    } catch { /* ignore */ }
    return () => {
      try {
        channel?.untrack();
        if (channel) supabase.removeChannel(channel);
      } catch { /* ignore */ }
    };
  }, [joined, roomId]);

  // Mount Jitsi after user joins
  useEffect(() => {
    if (!joined || !jitsiContainer.current || !jaasToken) return;
    let disposed = false;
    setLoadingCall(true);
    setLoadError(null);

    loadJitsiScript()
      .then((JitsiMeetExternalAPI) => {
        if (disposed || !jitsiContainer.current) return;
        const api = new JitsiMeetExternalAPI("8x8.vc", {
          roomName: jaasRoomName,
          jwt: jaasToken,
          parentNode: jitsiContainer.current,
          width: "100%",
          height: "100%",
          userInfo: { displayName: displayName || "Guest" },
          configOverwrite: {
            prejoinPageEnabled: false,
            prejoinConfig: { enabled: false },
            disableDeepLinking: true,
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            disableInviteFunctions: false,
          },
          interfaceConfigOverwrite: {
            MOBILE_APP_PROMO: false,
            SHOW_JITSI_WATERMARK: false,
            SHOW_BRAND_WATERMARK: false,
            DEFAULT_BACKGROUND: "#1a0b2e",
          },
        });
        apiRef.current = api;
        setLoadingCall(false);
        api.addListener("videoConferenceJoined", () => setLoadingCall(false));
        api.addListener("readyToClose", () => navigate({ to: "/" }));
      })
      .catch((err: Error) => {
        console.error(err);
        setLoadError(err.message || "Could not load video call");
        setLoadingCall(false);
      });

    return () => {
      disposed = true;
      try { apiRef.current?.dispose(); } catch { /* ignore */ }
      apiRef.current = null;
    };
  }, [joined, jaasToken, jaasRoomName, displayName, navigate]);

  const enterMeeting = async () => {
    const name = displayName.trim();
    if (!name) { toast.error("Please enter your name"); return; }
    localStorage.setItem("henosis_display_name", name);
    setDisplayName(name);
    setJoiningCall(true);
    try {
      const creatorToken = localStorage.getItem(`henosis_creator_${roomId}`) ?? undefined;
      const res = await getToken({ data: { displayName: name, roomId, creatorToken } });
      if (res.error || !res.token) {
        toast.error(res.error ?? "Could not connect to meeting service");
        return;
      }
      setJaasToken(res.token);
      setJaasRoomName(res.roomName);
      setJoined(true);
    } catch {
      toast.error("Could not connect to meeting service");
    } finally {
      setJoiningCall(false);
    }
  };

  // Moderator only: toggles transcription for the entire room
  const toggleTranscription = () => {
    const ch = transcriptChannelRef.current;
    if (globalListening) {
      setGlobalListening(false);
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      ch?.send({ type: "broadcast", event: "control", payload: { action: "stop" } });
    } else {
      if (!supported) return;
      setGlobalListening(true);
      try { recognitionRef.current?.start(); } catch { /* ignore */ }
      ch?.send({ type: "broadcast", event: "control", payload: { action: "start" } });
      toast.success("Recording started. All participants are being transcribed.");
    }
  };

  const generate = async () => {
    if (!transcript.trim()) {
      toast.error("Start transcription first to capture audio.");
      return;
    }
    setGenerating(true);
    setNotes(null);
    try {
      const res = await summarize({ data: { transcript: transcript.trim(), meetingTitle: roomId } });
      if (res.error) toast.error(res.error);
      else { setNotes(res.notes); toast.success("Meeting notes ready"); }
    } catch (e) {
      console.error(e);
      toast.error("Couldn't generate notes.");
    } finally {
      setGenerating(false);
    }
  };

  const copyLink = async () => {
    const host = window.location.host;
    const isPreview = /lovableproject\.com$/.test(host) || /^id-preview--/.test(host);
    const publicOrigin = isPreview ? "https://henosismeet.lovable.app" : window.location.origin;
    await navigator.clipboard.writeText(`${publicOrigin}/meeting/${roomId}`);
    toast.success("Meeting link copied. Anyone can join, no sign-in needed.");
  };

  const copyNotes = async () => {
    if (!notes) return;
    await navigator.clipboard.writeText(notes);
    toast.success("Notes copied to clipboard");
  };

  // Combined interim display for moderator
  const interimDisplay = Object.entries(interimMap)
    .filter(([, t]) => t.trim())
    .map(([speaker, t]) => `${speaker}: ${t}`)
    .join("\n");

  // ---- Pre-join screen ----
  if (!joined) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center px-4 py-10"
        style={{ background: "var(--gradient-dark-hero)" }}
      >
        {/* Nav */}
        <div className="fixed top-0 w-full border-b border-white/[0.06]" style={{ background: "oklch(0.08 0.04 295 / 0.85)", backdropFilter: "blur(20px)" }}>
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "var(--gradient-hero)" }}>
                <Video className="h-4 w-4 text-white" />
              </div>
              <span className="font-display text-[15px] font-semibold tracking-tight text-white">Henosis Meet</span>
            </div>
            <button onClick={() => navigate({ to: "/" })} className="text-xs text-white/35 transition-colors hover:text-white/70">
              ← Back
            </button>
          </div>
        </div>

        {/* Card */}
        <div className="ui-fade-up w-full max-w-sm pt-8">
          <p className="mb-8 text-center text-[11px] font-semibold tracking-[0.22em] text-white/30">
            JOINING ROOM
          </p>
          <h1
            className="mb-1 text-center font-display font-bold text-white"
            style={{ fontSize: "clamp(1.6rem, 4vw, 2.25rem)", letterSpacing: "-0.03em" }}
          >
            {roomId}
          </h1>
          <p className="mb-10 text-center text-sm text-white/35">Enter your name to join</p>

          <div className="space-y-3">
            <input
              autoFocus
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="h-[52px] w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 text-sm text-white placeholder:text-white/25 outline-none transition-colors focus:border-white/20 focus:bg-white/[0.08]"
              onKeyDown={(e) => e.key === "Enter" && enterMeeting()}
            />
            <button
              className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
              style={{ background: "var(--gradient-hero)" }}
              onClick={enterMeeting}
              disabled={joiningCall}
            >
              {joiningCall ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Connecting</>
              ) : (
                <><Video className="h-4 w-4" /> Join meeting</>
              )}
            </button>
            <button
              onClick={copyLink}
              className="flex h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] text-sm text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white/90"
            >
              <Copy className="h-4 w-4" /> Copy invite link
            </button>
          </div>

          <p className="mt-8 text-center text-xs text-white/20">
            No sign-up needed. Anyone with the link can join.
          </p>
        </div>
      </div>
    );
  }

  // ---- In-meeting screen ----
  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/" })} className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Leave
          </Button>
          <div className="hidden items-center gap-2 sm:flex">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg text-primary-foreground"
              style={{ background: "var(--gradient-hero)" }}
            >
              <Video className="h-4 w-4" />
            </div>
            <span className="font-display text-sm font-semibold">{roomId}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {globalListening && (
            <span className="flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
              Recording
            </span>
          )}
          <Button variant="outline" size="sm" onClick={copyLink} className="gap-2">
            <Copy className="h-4 w-4" /> Share link
          </Button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden p-3 lg:grid-cols-[1fr_380px]">
        {/* Jitsi */}
        <div className="relative overflow-hidden rounded-2xl bg-black shadow-[var(--shadow-elevated)]">
          <div ref={jitsiContainer} className="h-full w-full" />
          {loadingCall && !loadError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-white">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-accent" />
                <p className="text-sm">Connecting to the call…</p>
              </div>
            </div>
          )}
          {loadError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/85 px-6 text-center text-white">
              <div className="max-w-sm">
                <p className="font-semibold">Couldn't load the video call</p>
                <p className="mt-2 text-sm text-white/70">{loadError}</p>
                <Button className="mt-4" variant="outline" onClick={() => window.location.reload()}>
                  Try again
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar — full note taker for moderator, status badge for guests */}
        <aside className="flex min-h-0 flex-col gap-3">
          {isModerator ? (
            <>
              {/* Moderator: full AI Note-Taker */}
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-base font-semibold">AI Note-Taker</h2>
                    <p className="text-xs text-muted-foreground">
                      {supported
                        ? globalListening
                          ? "Transcribing all participants…"
                          : "Idle, start to capture everyone"
                        : "Speech recognition not supported. Try Chrome or Edge."}
                    </p>
                  </div>
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${globalListening ? "animate-pulse bg-destructive" : "bg-muted-foreground/30"}`}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={toggleTranscription}
                    disabled={!supported}
                    variant={globalListening ? "destructive" : "default"}
                    className="flex-1 gap-2"
                    style={globalListening ? undefined : { background: "var(--gradient-hero)" }}
                  >
                    {globalListening ? (
                      <><MicOff className="h-4 w-4" /> Stop</>
                    ) : (
                      <><Mic className="h-4 w-4" /> Start</>
                    )}
                  </Button>
                  <Button
                    onClick={generate}
                    disabled={generating || !transcript.trim()}
                    variant="outline"
                    className="flex-1 gap-2"
                  >
                    {generating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 text-accent" />
                    )}
                    Notes
                  </Button>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <FileText className="h-4 w-4 text-primary" />
                    {notes ? "Meeting Notes" : "Live Transcript"}
                  </h3>
                  {notes && (
                    <Button variant="ghost" size="sm" onClick={copyNotes} className="h-7 gap-1 text-xs">
                      <Copy className="h-3 w-3" /> Copy
                    </Button>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm leading-relaxed">
                  {notes ? (
                    <Notes markdown={notes} />
                  ) : transcript || interimDisplay ? (
                    <p className="whitespace-pre-wrap text-foreground/90">
                      {transcript}
                      <span className="text-muted-foreground">{interimDisplay}</span>
                    </p>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
                      <Mic className="mb-3 h-8 w-8 opacity-40" />
                      <p className="text-sm">
                        Click <span className="font-medium text-foreground">Start</span> to begin
                        transcribing all participants.
                      </p>
                      <p className="mt-2 text-xs">
                        Everyone's mic is captured. Hit{" "}
                        <span className="font-medium text-foreground">Notes</span> when done.
                      </p>
                    </div>
                  )}
                </div>
                {notes && (
                  <div className="border-t border-border p-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => setNotes(null)}
                    >
                      Back to transcript
                    </Button>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Guest: just a status card */
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                    globalListening ? "bg-destructive/10" : "bg-muted"
                  }`}
                >
                  {globalListening ? (
                    <Mic className="h-4 w-4 text-destructive" />
                  ) : (
                    <MicOff className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold">
                    {globalListening ? "Recording in progress" : "Recording off"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {globalListening
                      ? "Your mic is being transcribed by the host's AI note-taker."
                      : "The host will start recording when needed."}
                  </p>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

const Notes = React.memo(({ markdown }: { markdown: string }) => {
  const lines = React.useMemo(() => markdown.split("\n"), [markdown]);
  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        if (/^##\s/.test(line))
          return (
            <h4 key={i} className="mt-3 font-display text-sm font-semibold text-primary">
              {line.replace(/^##\s/, "")}
            </h4>
          );
        if (/^#\s/.test(line))
          return (
            <h3 key={i} className="mt-3 font-display text-base font-bold">
              {line.replace(/^#\s/, "")}
            </h3>
          );
        if (/^\s*-\s\[\s\]\s/.test(line))
          return (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-1 h-3.5 w-3.5 shrink-0 rounded border border-border" />
              <span>{line.replace(/^\s*-\s\[\s\]\s/, "")}</span>
            </div>
          );
        if (/^\s*-\s/.test(line))
          return (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span>{line.replace(/^\s*-\s/, "")}</span>
            </div>
          );
        if (line.trim() === "") return <div key={i} className="h-1" />;
        return <p key={i} className="text-foreground/90">{line}</p>;
      })}
    </div>
  );
});
