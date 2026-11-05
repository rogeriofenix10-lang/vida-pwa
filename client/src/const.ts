import { OAUTH_STATE_COOKIE, encodeOAuthState } from "@shared/const";
import { ENV } from "./_core/env";

export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Start the Manus OAuth login. Call this from an event handler or effect at the
// moment you want to navigate, e.g. `onClick={() => startLogin()}`.
//
// It has SIDE EFFECTS — it mints a one-time nonce, writes the __Host- state
// cookie, and navigates immediately — so the cookie nonce always matches the
// `state` it sends. Do NOT call it during render (no `href={startLogin()}` /
// `loginUrl={...}`): each call overwrites the cookie, so a stray render-phase
// call would desync it from an in-flight login and the callback would reject it
// with "invalid oauth state". It returns void by design, so there is no URL to
// stash across renders.
export const startLogin = () => {
  const oauthPortalUrl = ENV.oAuthPortalUrl;
  const appId = ENV.appId;

  if (!oauthPortalUrl || !appId) {
    console.error("[Auth] OAuth não configurado: defina VITE_OAUTH_PORTAL_URL e VITE_APP_ID.");
    window.dispatchEvent(new CustomEvent("iris:auth-config-missing"));
    return;
  }

  const redirectUri = `${window.location.origin}/api/oauth/callback`;

  const nonce = crypto.randomUUID();
  document.cookie = `${OAUTH_STATE_COOKIE}=${nonce}; Path=/; Max-Age=600; SameSite=None; Secure`;
  const state = encodeOAuthState({ redirectUri, nonce });

  let url: URL;
  try {
    url = new URL(`${oauthPortalUrl.replace(/\/+$/, "")}/app-auth`);
  } catch (error) {
    console.error("[Auth] URL do portal OAuth inválida.", error);
    window.dispatchEvent(new CustomEvent("iris:auth-config-missing"));
    return;
  }
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  window.location.href = url.toString();
};
