import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { setWorkspaceId } from '../api/vantage'

interface WorkspaceContextValue {
  workspaceId: string | null
  loading: boolean
}

const WorkspaceContext = createContext<WorkspaceContextValue>({ workspaceId: null, loading: true })

export function useWorkspace() {
  return useContext(WorkspaceContext)
}

async function fetchOrCreateWorkspace(token: string): Promise<string | null> {
  const base = ((import.meta.env.VITE_VANTAGE_API_URL as string | undefined) ?? '').replace(/\/$/, '')
  if (!base) return null
  try {
    const res = await fetch(`${base}/v1/workspaces/me`, {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data as { id: string }).id ?? null
  } catch {
    return null
  }
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function init() {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) {
        setLoading(false)
        return
      }
      const id = await fetchOrCreateWorkspace(token)
      if (!cancelled) {
        setWorkspaceId(id)
        setWorkspaceIdState(id)
        setLoading(false)
      }
    }

    void init()

    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, session) => {
      if (!session) {
        setWorkspaceId(null)
        setWorkspaceIdState(null)
        setLoading(false)
        return
      }
      const id = await fetchOrCreateWorkspace(session.access_token)
      if (!cancelled) {
        setWorkspaceId(id)
        setWorkspaceIdState(id)
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  return (
    <WorkspaceContext.Provider value={{ workspaceId, loading }}>
      {children}
    </WorkspaceContext.Provider>
  )
}
