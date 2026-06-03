/**
 * Nexus SSO integration.
 *
 * Auth is centralized in the Nexus SSO app (BioLoop suite, shared nexus-core
 * Supabase). Unauthenticated users are redirected to Nexus with `?redirect_to=`;
 * Nexus signs them in and redirects back with the session tokens in the URL hash
 * (implicit flow), which the Supabase client picks up via detectSessionInUrl.
 */
import { supabase } from "../supabase";

const NEXUS_URL = (import.meta.env.VITE_NEXUS_AUTH_URL as string | undefined)?.replace(/\/$/, "");

export function isSsoConfigured(): boolean {
  return !!NEXUS_URL;
}

/** Send the user to Nexus SSO; they return to `returnTo` after signing in. */
export function redirectToNexus(returnTo: string = window.location.origin): void {
  if (!NEXUS_URL) throw new Error("VITE_NEXUS_AUTH_URL is not set");
  const url = new URL(NEXUS_URL);
  url.searchParams.set("redirect_to", returnTo);
  window.location.assign(url.toString());
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** Clear the local session, then bounce through Nexus logout to clear the shared one. */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
  if (NEXUS_URL) {
    const url = new URL(`${NEXUS_URL}/logout`);
    url.searchParams.set("redirect_to", window.location.origin);
    window.location.assign(url.toString());
  } else {
    window.location.href = "/login";
  }
}
