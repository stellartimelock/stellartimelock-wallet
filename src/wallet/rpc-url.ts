// Custom Soroban RPC must be HTTPS with no userinfo.
// Cleartext lets a network attacker rewrite simulation fees and auth.

export function isHttpsRpcUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return (
      url.protocol === "https:" &&
      url.hostname.length > 0 &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}
