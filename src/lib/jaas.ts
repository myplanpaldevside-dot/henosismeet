import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ── helpers ──────────────────────────────────────────────────────────────────

function b64url(str: string): string {
  return btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** HMAC-SHA256 of roomId using the JaaS private key as the secret.
 *  Only the server can produce this value, so clients can't forge moderator status. */
async function computeCreatorToken(roomId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret.slice(0, 64)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(roomId));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function signJwt(
  appId: string,
  keyId: string,
  privateKeyBase64: string,
  displayName: string,
  isModerator: boolean,
): Promise<string> {
  const keyBytes = Uint8Array.from(atob(privateKeyBase64.replace(/\s/g, "")), (c) =>
    c.charCodeAt(0),
  );

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const now = Math.floor(Date.now() / 1000);

  const header = b64url(JSON.stringify({ alg: "RS256", kid: keyId, typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      aud: "jitsi",
      iss: "chat",
      iat: now,
      exp: now + 7200,
      nbf: now - 10,
      sub: appId,
      context: {
        features: {
          livestreaming: false,
          "outbound-call": false,
          "sip-outbound-call": false,
          transcription: false,
          recording: false,
        },
        user: {
          "hidden-from-recorder": false,
          moderator: isModerator,
          name: displayName,
          id: crypto.randomUUID(),
          avatar: "",
          email: "",
        },
      },
      room: "*",
    }),
  );

  const sigInput = new TextEncoder().encode(`${header}.${payload}`);
  const sigBuffer = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, cryptoKey, sigInput);
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${header}.${payload}.${sig}`;
}

// ── server functions ──────────────────────────────────────────────────────────

/** Called when starting a new meeting. Returns a signed creator token that
 *  the browser stores in localStorage to claim moderator status on join. */
export const createMeeting = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ roomId: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data }) => {
    const privateKey = process.env.JAAS_PRIVATE_KEY ?? "";
    const creatorToken = await computeCreatorToken(data.roomId, privateKey);
    return { creatorToken };
  });

/** Called on every join. Verifies the creator token server-side before
 *  granting moderator status — guests who didn't create the room get a
 *  plain participant token and cannot kick or mute others. */
export const getJaasToken = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        displayName: z.string().min(1).max(200),
        roomId: z.string().min(1).max(200),
        creatorToken: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const appId = process.env.JAAS_APP_ID;
    const keyId = process.env.JAAS_KEY_ID;
    const privateKey = process.env.JAAS_PRIVATE_KEY;

    if (!appId || !keyId || !privateKey) {
      return { error: "JaaS not configured", token: null as null | string, roomName: "" };
    }

    // Verify the creator token server-side — can't be faked without the private key
    let isModerator = false;
    if (data.creatorToken) {
      const expected = await computeCreatorToken(data.roomId, privateKey);
      isModerator = data.creatorToken === expected;
    }

    try {
      const token = await signJwt(appId, keyId, privateKey, data.displayName, isModerator);
      return { error: null as null | string, token, roomName: `${appId}/${data.roomId}` };
    } catch (err) {
      console.error("JWT sign failed", err);
      return { error: "Failed to create meeting token", token: null as null | string, roomName: "" };
    }
  });
