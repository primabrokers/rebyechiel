export async function computeSha256(content: string | Uint8Array): Promise<string> {
  const data = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
