import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { summarizeMeeting } from "@/lib/ai.functions";

export const Route = createFileRoute("/meeting/$roomId")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.roomId} — Henosis Meet` },
      { name: "description", content: "Live video meeting with AI note-taking." },
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

function MeetingRoom() {
  const { roomId } = Route.useParams();
  const navigate = useNavigate();
  const jitsiContainer = useRef<HTMLDivElement>(null);

  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [notes, setNotes] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const summarize = useServerFn(summarizeMeeting);

  // Embed Jitsi
  useEffect(() => {
    if (!jitsiContainer.current) return;
    const iframe = document.createElement("iframe");
    iframe.src = `https://meet.jit.si/${encodeURIComponent(roomId)}#config.prejoinPageEnabled=true&userInfo.displayName=%22Henosis%22`;
    iframe.allow =
      "camera; microphone; fullscreen; display-capture; autoplay; clipboard-write";
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "0";
    iframe.style.borderRadius = "16px";
    jitsiContainer.current.innerHTML = "";
    jitsiContainer.current.appendChild(iframe);
  }, [roomId]);

  // Set up speech recognition
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
    rec.onerror = (e) => {
      console.error("Speech recognition error", e);
    };
    rec.onend = () => {
      // auto-restart while user wants to listen
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
      if (res.error) {
        toast.error(res.error);
      } else {
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
    await navigator.clipboard.writeText(window.location.href);
    toast.success("Meeting link copied");
  };

  const copyNotes = async () => {
    if (!notes) return;
    await navigator.clipboard.writeText(notes);
    toast.success("Notes copied to clipboard");
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
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

      {/* Main grid */}
      <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden p-3 lg:grid-cols-[1fr_380px]">
        {/* Jitsi */}
        <div
          ref={jitsiContainer}
          className="overflow-hidden rounded-2xl bg-black shadow-[var(--shadow-elevated)]"
        />

        {/* Sidebar */}
        <aside className="flex min-h-0 flex-col gap-3">
          {/* Controls card */}
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
                style={
                  listening ? undefined : { background: "var(--gradient-hero)" }
                }
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

          {/* Transcript / Notes */}
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

// Tiny markdown renderer (headings, bullets, checkboxes)
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

// silence unused import warning when Link tree-shaken
void Link;
