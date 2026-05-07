export function SettingsPage() {
  return (
    <div>
      <h1>Settings</h1>
      <p>
        API base is set at build time via <code>VITE_VANTAGE_API_URL</code>. Supabase keys use{" "}
        <code>VITE_SUPABASE_*</code>.
      </p>
    </div>
  );
}
