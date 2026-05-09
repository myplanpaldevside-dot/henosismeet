import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  transcript: z.string().min(1).max(50000),
  meetingTitle: z.string().max(200).optional(),
});

export const summarizeMeeting = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return { error: "AI service not configured", notes: null as null | string };
    }

    const systemPrompt = `You are an AI meeting note-taker for Henosis NGO. Given a raw live-transcript of a video meeting, produce concise, structured meeting notes in markdown with these sections:

## Summary
2-4 sentences capturing the meeting's purpose and outcome.

## Key Discussion Points
- Bullet points of the main topics discussed.

## Decisions Made
- Concrete decisions, or "None recorded" if absent.

## Action Items
- [ ] Owner — task — (deadline if mentioned)
Use "Unassigned" when no owner is clear.

## Open Questions
- Anything unresolved.

Keep it tight. Do not invent facts not in the transcript.`;

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `Meeting${data.meetingTitle ? `: ${data.meetingTitle}` : ""}\n\nTranscript:\n${data.transcript}`,
            },
          ],
        }),
      });

      if (res.status === 429) {
        return { error: "Rate limit reached. Please wait a moment and try again.", notes: null };
      }
      if (res.status === 402) {
        return { error: "AI credits exhausted. Add credits in workspace settings.", notes: null };
      }
      if (!res.ok) {
        const text = await res.text();
        console.error("AI gateway error", res.status, text);
        return { error: `AI service error (${res.status})`, notes: null };
      }

      const json = await res.json();
      const notes: string = json?.choices?.[0]?.message?.content ?? "";
      return { error: null as null | string, notes };
    } catch (err) {
      console.error("summarizeMeeting failed", err);
      return { error: "Failed to generate notes.", notes: null };
    }
  });
