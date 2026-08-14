import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { setWorkspaceId } from '../api/vantage'

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer'
export interface WorkspaceSummary {
  id: string
  name: string
  slug: string
  role: WorkspaceRole
}

interface WorkspaceContextValue {
  workspaceId: string | null
  workspaces: WorkspaceSummary[]
  loading: boolean
  switchWorkspace: (id: string) => void
  createWorkspace: (name: string) => Promise<WorkspaceSummary>
  refresh: () => Promise<void>
}

/** Survives reloads so the operator returns to the workspace they were last in. */
const ACTIVE_KEY = 'vantage_active_workspace'

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspaceId: null,
  workspaces: [],
  loading: true,
  switchWorkspace: () => {},
  createWorkspace: async () => { throw new Error('WorkspaceProvider not mounted') },
  refresh: async () => {},
})

export function useWorkspace() {
  return useContext(WorkspaceContext)
}

const base = ((import.meta.env.VITE_VANTAGE_API_URL as string | undefined) ?? '').replace(/\/$/, '')

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T | null> {
  if (!base) return null
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/**
 * Fetch the caller's workspaces. The API's workspaceGuard lazily provisions one
 * on first access, so this returns at least one entry for any authenticated
 * user — no separate bootstrap call is needed.
 */
async function fetchWorkspaces(token: string): Promise<WorkspaceSummary[]> {
  const data = await api<{ workspaces: WorkspaceSummary[] }>(token, '/v1/workspaces')
  return data?.workspaces ?? []
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const tokenRef = useRef<string | null>(null)

  /**
   * Pick the active workspace and publish it to the module-level cache that
   * vantageFetch reads for its x-workspace-id header. The cache lives outside
   * React, so it must be set here rather than in a render effect — every
   * request issued after this point carries the new workspace.
   */
  const activate = useCallback((id: string | null) => {
    setWorkspaceId(id)
    setWorkspaceIdState(id)
    if (typeof localStorage !== 'undefined') {
      if (id) localStorage.setItem(ACTIVE_KEY, id)
      else localStorage.removeItem(ACTIVE_KEY)
    }
  }, [])

  const load = useCallback(async (token: string): Promise<WorkspaceSummary[]> => {
    const list = await fetchWorkspaces(token)
    setWorkspaces(list)

    // A remembered id is only usable if the user still belongs to it —
    // membership can be revoked, and sending a stale id would 403 every call.
    const remembered = typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_KEY) : null
    const active = list.find((w) => w.id === remembered) ?? list[0] ?? null
    activate(active?.id ?? null)
    return list
  }, [activate])

  useEffect(() => {
    let cancelled = false

    async function init(token: string | undefined) {
      if (!token) {
        tokenRef.current = null
        activate(null)
        setWorkspaces([])
        setLoading(false)
        return
      }
      tokenRef.current = token
      await load(token)
      if (!cancelled) setLoading(false)
    }

    void (async () => {
      const { data } = await supabase.auth.getSession()
      if (!cancelled) await init(data.session?.access_token)
    })()

    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, session) => {
      if (!cancelled) await init(session?.access_token)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [load, activate])

  const switchWorkspace = useCallback((id: string) => {
    if (id === workspaceId) return
    if (!workspaces.some((w) => w.id === id)) return
    activate(id)
  }, [workspaceId, workspaces, activate])

  const refresh = useCallback(async () => {
    if (tokenRef.current) await load(tokenRef.current)
  }, [load])

  const createWorkspace = useCallback(async (name: string): Promise<WorkspaceSummary> => {
    const token = tokenRef.current
    if (!token) throw new Error('Not signed in')
    const created = await api<WorkspaceSummary>(token, '/v1/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    if (!created) throw new Error('Could not create workspace')
    setWorkspaces((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
    activate(created.id)
    return created
  }, [activate])

  return (
    <WorkspaceContext.Provider
      value={{ workspaceId, workspaces, loading, switchWorkspace, createWorkspace, refresh }}
    >
      {children}
    </WorkspaceContext.Provider>
  )
}
