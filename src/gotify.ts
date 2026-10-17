export interface GotifyPayload { title: string; message: string; priority: number; contentType: string }

export async function sendGotify(baseUrl: string, token: string, p: GotifyPayload, timeoutMs = 10000): Promise<void> {
  if (!baseUrl) throw new Error("no Gotify URL configured");
  const url = baseUrl.replace(/\/+$/, "") + "/message";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Gotify-Key": token },
    body: JSON.stringify({
      title: p.title, message: p.message, priority: p.priority,
      extras: { "client::display": { contentType: p.contentType } },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Gotify returned HTTP ${res.status}`);
}
