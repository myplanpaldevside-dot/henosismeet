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

export const Route = createFileRoute("/meeting/$roomId")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.roomId} — Henosis Meet` },
      { name: "description", content: "Join the Henosis Meet video call — no sign-up required." },
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
    [i: number]: {
      isFinal: boolean;
      [j: number]: { transcript: string };
    };
  };
}

// --- Jitsi External API typing ---
type JitsiAPI = {
  dispose: () => void;
  addListener: (event: string, cb: (...args: unknown[]) => void) => void;
  executeCommand: (cmd: string, ...args: unknown[]) => void;
};
type JitsiConstructor = new (
  domain: string,
  options: Record<string, unknown>,
) => JitsiAPI;

function loadJitsiScript(): Promise<JitsiConstructor> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { JitsiMeetExternalAPI?: JitsiConstructor };
    if (w.JitsiMeetExternalAPI) return resolve(w.JitsiMeetExternalAPI);
    const existing = document.getElementById("jitsi-external-api") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => {
        const ww = window as unknown as { JitsiMeetExternalAPI?: JitsiConstructor };
        ww.JitsiMeetExternalAPI ? resolve(ww.JitsiMeetExternalAPI) : reject(new Error("Jitsi failed to load"));
      });
      return;
    }
    const s = document.createElement("script");
    s.id = "jitsi-external-api";
    s.src = "https://meet.jit.si/external_api.js";
    s.async = true;
    s.onload = () => {
      const ww = window as unknown as { JitsiMeetExternalAPI?: JitsiConstructor };
      ww.JitsiMeetExternalAPI ? resolve(ww.JitsiMeetExternalAPI) : reject(new Error("Jitsi failed to load"));
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

  const [displayName, setDisplayName] = useState("");
  const [joined, setJoined] = useState(false);
  const [loadingCall, setLoadingCall] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [joiningCall, setJoiningCall] = useState(false);
  const [jaasToken, setJaasToken] = useState<string | null>(null);
  const [jaasRoomName, setJaasRoomName] = useState("");

  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [notes, setNotes] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const summarize = useServerFn(summarizeMeeting);
  const getToken = useServerFn(getJaasToken);

  // Restore stored name
  useEffect(() => {
    const stored = localStorage.getItem("henosis_display_name");
    if (stored) setDisplayName(stored);
  }, []);

  // Speech recognition
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
      if (finalChunk) setTranscript((prev) => prev + finalChunk);
      setInterim(interimChunk);
    };
    rec.onerror = (e) => console.error("Speech recognition error", e);
    rec.onend = () => {
      if (recognitionRef.current && listeningRef.current) {
        try {
          rec.start();
        } catch {
          /* ignore */
        }
      }
    };
    recognitionRef.current = rec;
    return () => {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    };
  }, []);

  const listeningRef = useRef(false);
  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  // Broadcast presence so the landing page can show this meeting as active
  useEffect(() => {
    if (!joined) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase.channel("active-meetings");
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel!.track({ roomId });
        }
      });
    } catch {
      /* Supabase not available — presence is optional */
    }
    return () => {
      try {
        channel?.untrack();
        if (channel) supabase.removeChannel(channel);
      } catch {
        /* ignore */
      }
    };
  }, [joined, roomId]);

  // Mount Jitsi after user joins (requires JaaS token)
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
      try {
        apiRef.current?.dispose();
      } catch {
        /* ignore */
      }
      apiRef.current = null;
    };
  }, [joined, jaasToken, jaasRoomName, displayName, navigate]);

  const enterMeeting = async () => {
    const name = displayName.trim();
    if (!name) {
      toast.error("Please enter your name");
      return;
    }
    localStorage.setItem("henosis_display_name", name);
    setDisplayName(name);
    setJoiningCall(true);
    try {
      const res = await getToken({ data: { displayName: name, roomId } });
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

  const toggleListen = () => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (listening) {
      setListening(false);
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    } else {
      setListening(true);
      try {
        rec.start();
        toast.success("Transcribing your microphone");
      } catch {
        /* ignore */
      }
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
      const res = await summarize({
        data: { transcript: transcript.trim(), meetingTitle: roomId },
      });
      if (res.error) toast.error(res.error);
      else {
        setNotes(res.notes);
        toast.success("Meeting notes ready");
      }
    } catch (e) {
      console.error(e);
      toast.error("Couldn't generate notes.");
    } finally {
      setGenerating(false);
    }
  };

  const copyLink = async () => {
    // Always share the public published URL, never the editor preview URL
    // (preview URLs like id-preview--*.lovable.app require a Lovable login).
    const host = window.location.host;
    const isPreview = /lovableproject\.com$/.test(host) || /^id-preview--/.test(host);
    const publicOrigin = isPreview
      ? "https://henosismeet.lovable.app"
      : window.location.origin;
    const shareUrl = `${publicOrigin}/meeting/${roomId}`;
    await navigator.clipboard.writeText(shareUrl);
    toast.success("Public meeting link copied — anyone can join, no sign-in needed");
  };

  const copyNotes = async () => {
    if (!notes) return;
    await navigator.clipboard.writeText(notes);
    toast.success("Notes copied to clipboard");
  };

  // ---- Pre-join screen ----
  if (!joined) {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-4 py-10"
        style={{ background: "var(--gradient-soft)" }}
      >
        <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-[var(--shadow-elevated)]">
          <div
            className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl text-primary-foreground"
            style={{ background: "var(--gradient-hero)" }}
          >
            <Video className="h-6 w-6" />
          </div>
          <h1 className="text-center font-display text-2xl font-bold tracking-tight">
            Join the meeting
          </h1>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Room <span className="font-medium text-foreground">{roomId}</span>
          </p>

          <div className="mt-6 space-y-3">
            <label className="text-sm font-medium">Your name</label>
            <Input
              autoFocus
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Amina from Henosis"
              className="h-12"
              onKeyDown={(e) => e.key === "Enter" && enterMeeting()}
            />
            <Button
              className="h-12 w-full gap-2 text-base font-semibold"
              style={{ background: "var(--gradient-hero)" }}
              onClick={enterMeeting}
              disabled={joiningCall}
            >
              {joiningCall ? (
                <><Loader2 className="h-5 w-5 animate-spin" /> Connecting…</>
              ) : (
                <><Video className="h-5 w-5" /> Join meeting</>
              )}
            </Button>
            <Button
              variant="outline"
              className="h-11 w-full gap-2"
              onClick={copyLink}
            >
              <Copy className="h-4 w-4" /> Copy invite link
            </Button>
          </div>

          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            No sign-up needed. Anyone with the link can join.
          </div>

          <button
            onClick={() => navigate({ to: "/" })}
            className="mt-6 block w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back to home
          </button>
        </div>
      </div>
    );
  }

  // ---- In-meeting screen ----
  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ to: "/" })}
            className="gap-1"
          >
            <ArrowLeft className="h-4 w-4" />
            Leave
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
                <Button
                  className="mt-4"
                  variant="outline"
                  onClick={() => window.location.reload()}
                >
                  Try again
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="flex min-h-0 flex-col gap-3">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-semibold">AI Note-Taker</h2>
                <p className="text-xs text-muted-foreground">
                  {supported
                    ? listening
                      ? "Listening to your microphone…"
                      : "Idle — start to capture"
                    : "Speech recognition not supported in this browser. Try Chrome or Edge."}
                </p>
              </div>
              <span
                className={`h-2.5 w-2.5 rounded-full ${listening ? "animate-pulse bg-destructive" : "bg-muted-foreground/30"}`}
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={toggleListen}
                disabled={!supported}
                variant={listening ? "destructive" : "default"}
                className="flex-1 gap-2"
                style={listening ? undefined : { background: "var(--gradient-hero)" }}
              >
                {listening ? (
                  <>
                    <MicOff className="h-4 w-4" /> Stop
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4" /> Start
                  </>
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
              ) : transcript || interim ? (
                <p className="whitespace-pre-wrap text-foreground/90">
                  {transcript}
                  <span className="text-muted-foreground">{interim}</span>
                </p>
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
                  <Mic className="mb-3 h-8 w-8 opacity-40" />
                  <p className="text-sm">
                    Click <span className="font-medium text-foreground">Start</span> to capture
                    audio from this device.
                  </p>
                  <p className="mt-2 text-xs">
                    When you're done, hit <span className="font-medium text-foreground">Notes</span>{" "}
                    to generate a structured summary.
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
        </aside>
      </div>
    </div>
  );
}

function Notes({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
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
        return (
          <p key={i} className="text-foreground/90">
            {line}
          </p>
        );
      })}
    </div>
  );
}
