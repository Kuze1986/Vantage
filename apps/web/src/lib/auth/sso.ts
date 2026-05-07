/**
 * Stub SSO — swap this file when wiring real nexus-holdings-io SSO.
 * Uses Supabase email/password for a single operator (Brandon) in dev/stub.
 */
import { supabase } from "../supabase";

export async function signInStub(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
