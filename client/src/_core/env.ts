export const ENV = {
  appId: String(import.meta.env.VITE_APP_ID ?? "").trim(),
  oAuthPortalUrl: String(import.meta.env.VITE_OAUTH_PORTAL_URL ?? "").trim(),
};
