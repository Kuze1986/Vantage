import React from 'react'
import { useWorkspace } from '../lib/WorkspaceContext'

/**
 * Workspace picker for the sidebar.
 *
 * Each workspace is a separate tenant — its own brand voice, channel
 * credentials, subscribers and billing quota — so switching is a meaningful
 * context change, not a filter. Layout remounts the page tree on change.
 *
 * Hidden entirely while the operator has only one workspace, so the common
 * single-tenant case gains no chrome.
 */
export function WorkspaceSwitcher() {
  const { workspaceId, workspaces, loading, switchWorkspace, createWorkspace } = useWorkspace()
  const [creating, setCreating] = React.useState(false)
  const [name, setName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setErr(null)
    try {
      await createWorkspace(trimmed)
      setName('')
      setCreating(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create workspace')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return null

  return (
    <div className="vg-sidebar__ws">
      {/* A single workspace needs no picker — only the escape hatch to add one. */}
      {workspaces.length > 1 && (
        <>
          <label className="vg-sidebar__ws-label" htmlFor="ws-switcher">Workspace</label>
          <select
            id="ws-switcher"
            className="vg-sidebar__ws-select"
            value={workspaceId ?? ''}
            onChange={(e) => switchWorkspace(e.target.value)}
            disabled={busy}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </>
      )}

      {creating ? (
        <div className="vg-sidebar__ws-create">
          <input
            className="vg-sidebar__ws-input"
            value={name}
            autoFocus
            placeholder="Workspace name"
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
              if (e.key === 'Escape') { setCreating(false); setName(''); setErr(null) }
            }}
          />
          <div className="vg-sidebar__ws-actions">
            <button
              type="button"
              className="nx-btn nx-btn--primary nx-btn--sm"
              disabled={busy || !name.trim()}
              onClick={() => void submit()}
            >
              {busy ? '…' : 'Create'}
            </button>
            <button
              type="button"
              className="nx-btn nx-btn--ghost nx-btn--sm"
              disabled={busy}
              onClick={() => { setCreating(false); setName(''); setErr(null) }}
            >
              Cancel
            </button>
          </div>
          {err && <p className="vg-sidebar__ws-err">{err}</p>}
        </div>
      ) : (
        <button type="button" className="vg-sidebar__ws-add" onClick={() => setCreating(true)}>
          + Workspace
        </button>
      )}
    </div>
  )
}
