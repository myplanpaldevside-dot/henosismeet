import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  displayName: z.string().min(1).max(200),
  roomId: z.string().min(1).max(200),
});

function b64url(str: string): string {
  return btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function signJwt(
  appId: string,
  keyId: string,
  privateKeyBase64: string,
  displayName: string,
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
          moderator: true,
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

export const getJaasToken = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const appId = process.env.JAAS_APP_ID;
    const keyId = process.env.JAAS_KEY_ID;
    const privateKey = process.env.JAAS_PRIVATE_KEY;

    if (!appId || !keyId || !privateKey) {
      return {
        error: "JaaS not configured",
        token: null as null | string,
        roomName: "",
      };
    }

    try {
      const token = await signJwt(appId, keyId, privateKey, data.displayName);
      return {
        error: null as null | string,
        token,
        roomName: `${appId}/${data.roomId}`,
      };
    } catch (err) {
      console.error("JWT sign failed", err);
      return {
        error: "Failed to create meeting token",
        token: null as null | string,
        roomName: "",
      };
    }
  });
