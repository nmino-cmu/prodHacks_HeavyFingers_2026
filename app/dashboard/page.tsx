"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, Leaf, RefreshCw, Users } from "lucide-react"

interface DashboardSummary {
  conversationCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  footprintKg: number
  averageConversationFootprintKg: number
}

interface UserMetric {
  userId: string
  userName: string
  conversationCount: number
  promptCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  footprintKg: number
  lastActiveAt: string
}

interface ConversationMetric {
  conversationId: string
  title: string
  userId: string
  userName: string
  updatedAt: string
  messageCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  footprintKg: number
}

interface CarbonDashboardResponse {
  generatedAt: string
  selectedUserId: string
  proofOfConceptSingleUser: boolean
  assumptions: {
    mode: string
    charsPerToken: number
    kgPerToken: number
  }
  summary: DashboardSummary
  controls: {
    routingSensitivity: number
    historyCompression: number
    userPromptThresholds: Record<string, number>
    lockedUserKnobs: Record<string, boolean>
  }
  availableUsers: UserMetric[]
  users: UserMetric[]
  conversations: ConversationMetric[]
}

function formatNumber(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString()
}

function formatKg(value: number): string {
  if (value >= 1) {
    return `${value.toFixed(2)} kg CO2e`
  }
  return `${(value * 1000).toFixed(2)} g CO2e`
}

function formatDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return "unknown"
  }
  return parsed.toLocaleString()
}

function clampControlValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  const rounded = Math.round(value)
  if (rounded < 0) return 0
  if (rounded > 100) return 100
  return rounded
}

function parsePositiveInteger(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return null
  }
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

export default function CarbonDashboardPage() {
  const [selectedUserId, setSelectedUserId] = useState("all")
  const [data, setData] = useState<CarbonDashboardResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [controlDraft, setControlDraft] = useState({
    routingSensitivity: 55,
    historyCompression: 50,
  })
  const [thresholdInput, setThresholdInput] = useState("")
  const [isSavingControls, setIsSavingControls] = useState(false)
  const [isSavingThreshold, setIsSavingThreshold] = useState(false)
  const [controlsStatus, setControlsStatus] = useState<string | null>(null)
  const [controlsError, setControlsError] = useState<string | null>(null)

  const loadData = useCallback(async (userId: string, isManualRefresh = false) => {
    if (isManualRefresh) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    setError(null)

    try {
      const query = userId !== "all" ? `?userId=${encodeURIComponent(userId)}` : ""
      const response = await fetch(`/api/carbon-dashboard${query}`, { cache: "no-store" })
      if (!response.ok) {
        throw new Error(`Dashboard API failed with status ${response.status}`)
      }

      const payload = (await response.json()) as CarbonDashboardResponse
      setData(payload)
    } catch (requestError) {
      console.error("Failed to load carbon dashboard data.", requestError)
      setError(requestError instanceof Error ? requestError.message : "Failed to load dashboard data.")
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadData("all")
  }, [loadData])

  useEffect(() => {
    if (!data) {
      return
    }
    setControlDraft({
      routingSensitivity: data.controls.routingSensitivity,
      historyCompression: data.controls.historyCompression,
    })
  }, [data])

  const maxConversationFootprint = useMemo(() => {
    if (!data || data.conversations.length === 0) {
      return 0
    }
    return Math.max(...data.conversations.map((conversation) => conversation.footprintKg))
  }, [data])

  const selectedUserLabel = useMemo(() => {
    if (!data) {
      return "All users"
    }
    if (selectedUserId === "all") {
      return "All users"
    }
    return data.availableUsers.find((user) => user.userId === selectedUserId)?.userName || selectedUserId
  }, [data, selectedUserId])

  const selectedUserMetric = useMemo(() => {
    if (!data || selectedUserId === "all") {
      return null
    }
    return data.availableUsers.find((user) => user.userId === selectedUserId) ?? null
  }, [data, selectedUserId])

  const selectedUserThreshold = useMemo(() => {
    if (!data || selectedUserId === "all") {
      return null
    }
    const rawThreshold = data.controls.userPromptThresholds[selectedUserId]
    if (typeof rawThreshold !== "number" || !Number.isFinite(rawThreshold) || rawThreshold <= 0) {
      return null
    }
    return Math.round(rawThreshold)
  }, [data, selectedUserId])

  const selectedUserKnobsLocked = useMemo(() => {
    if (!data || selectedUserId === "all") {
      return false
    }
    return data.controls.lockedUserKnobs[selectedUserId] === true
  }, [data, selectedUserId])

  const topKpiBars = useMemo(() => {
    const barCount = 16
    if (!data || data.conversations.length === 0) {
      return Array.from({ length: barCount }, () => 0.35)
    }

    const values = data.conversations
      .slice(0, barCount)
      .map((conversation) => Math.max(conversation.footprintKg, 0.0000001))
    while (values.length < barCount) {
      values.push(values[values.length - 1] ?? 0.35)
    }

    const maxValue = Math.max(...values)
    return values.map((value) => {
      if (maxValue <= 0) {
        return 0.35
      }
      return Math.min(1, Math.max(0.25, value / maxValue))
    })
  }, [data])

  useEffect(() => {
    if (selectedUserId === "all") {
      setThresholdInput("")
      return
    }
    setThresholdInput(selectedUserThreshold !== null ? String(selectedUserThreshold) : "")
  }, [selectedUserId, selectedUserThreshold])

  const updateKnobs = useCallback(async () => {
    setControlsError(null)
    setControlsStatus(null)
    setIsSavingControls(true)

    try {
      const response = await fetch("/api/carbon-dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routingSensitivity: clampControlValue(controlDraft.routingSensitivity),
          historyCompression: clampControlValue(controlDraft.historyCompression),
        }),
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error || `Failed with status ${response.status}`)
      }

      setControlsStatus("Routing and compression knobs updated.")
      await loadData(selectedUserId, true)
    } catch (requestError) {
      console.error("Failed to update routing controls from dashboard.", requestError)
      setControlsError(requestError instanceof Error ? requestError.message : "Failed to update controls.")
    } finally {
      setIsSavingControls(false)
    }
  }, [
    controlDraft.historyCompression,
    controlDraft.routingSensitivity,
    loadData,
    selectedUserId,
  ])

  const updateThreshold = useCallback(
    async (clearThreshold: boolean) => {
      if (selectedUserId === "all") {
        setControlsError("Select a specific user before updating a prompt threshold.")
        setControlsStatus(null)
        return
      }

      setControlsError(null)
      setControlsStatus(null)
      setIsSavingThreshold(true)

      try {
        const parsedThreshold = clearThreshold ? null : parsePositiveInteger(thresholdInput)
        if (!clearThreshold && parsedThreshold === null) {
          throw new Error("Threshold must be a whole number greater than 0.")
        }

        const response = await fetch("/api/carbon-dashboard", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: selectedUserId,
            promptThreshold: parsedThreshold,
          }),
        })

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null
          throw new Error(payload?.error || `Failed with status ${response.status}`)
        }

        setControlsStatus(
          clearThreshold
            ? `Prompt threshold cleared for ${selectedUserLabel}.`
            : `Prompt threshold set to ${parsedThreshold} for ${selectedUserLabel}.`,
        )
        await loadData(selectedUserId, true)
      } catch (requestError) {
        console.error("Failed to update prompt threshold from dashboard.", requestError)
        setControlsError(requestError instanceof Error ? requestError.message : "Failed to update threshold.")
      } finally {
        setIsSavingThreshold(false)
      }
    },
    [loadData, selectedUserId, selectedUserLabel, thresholdInput],
  )

  const updateKnobLock = useCallback(
    async (lockKnobs: boolean) => {
      if (selectedUserId === "all") {
        setControlsError("Select a specific user before locking or unlocking knobs.")
        setControlsStatus(null)
        return
      }

      setControlsError(null)
      setControlsStatus(null)
      setIsSavingControls(true)

      try {
        const response = await fetch("/api/carbon-dashboard", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: selectedUserId,
            lockKnobs,
          }),
        })

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null
          throw new Error(payload?.error || `Failed with status ${response.status}`)
        }

        setControlsStatus(
          lockKnobs
            ? `Knobs locked for ${selectedUserLabel}.`
            : `Knobs unlocked for ${selectedUserLabel}.`,
        )
        await loadData(selectedUserId, true)
      } catch (requestError) {
        console.error("Failed to update knob lock from dashboard.", requestError)
        setControlsError(requestError instanceof Error ? requestError.message : "Failed to update lock.")
      } finally {
        setIsSavingControls(false)
      }
    },
    [loadData, selectedUserId, selectedUserLabel],
  )

  const hasRows = (data?.conversations.length ?? 0) > 0

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#0b1117] text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.18),_transparent_48%),radial-gradient(circle_at_80%_20%,_rgba(16,185,129,0.15),_transparent_40%),linear-gradient(180deg,_#0b1117_0%,_#070b10_65%,_#05080c_100%)]" />
      <main className="relative mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-slate-800/80 bg-gradient-to-br from-slate-950/95 via-slate-900/85 to-slate-950/95 p-5 shadow-[0_25px_80px_rgba(2,6,23,0.75)] backdrop-blur-md sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold tracking-tight text-slate-100 sm:text-4xl">KPI Dashboard</p>
              <p className="mt-2 text-sm text-slate-400">
                Carbon and token performance with admin enforcement controls.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/75 px-3 py-2 font-mono text-sm text-slate-300">
                <Leaf className="h-3.5 w-3.5 text-emerald-300" />
                Live
              </span>
              <button
                type="button"
                onClick={() => void loadData(selectedUserId, true)}
                disabled={isLoading || isRefreshing}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm font-medium text-slate-100 transition hover:border-slate-500/80 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                Refresh
              </button>
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm font-medium text-slate-100 transition hover:border-slate-500/80 hover:bg-slate-800"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Chat
              </Link>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <article className="rounded-xl border border-slate-800 bg-gradient-to-r from-slate-900/90 to-slate-800/80 p-5">
              <p className="text-sm text-slate-400">Token Throughput</p>
              <p className="mt-2 text-4xl font-semibold text-slate-100">
                {data ? formatNumber(data.summary.totalTokens) : "—"}
              </p>
              <p className="mt-3 font-mono text-sm text-amber-300">
                P {data ? formatNumber(data.summary.promptTokens) : "—"} vs. C{" "}
                {data ? formatNumber(data.summary.completionTokens) : "—"}
              </p>
            </article>

            <article className="rounded-xl border border-slate-800 bg-gradient-to-r from-slate-900/90 to-slate-800/80 p-5">
              <p className="text-sm text-slate-400">Carbon (kgCO2e)</p>
              <p className="mt-2 text-4xl font-semibold text-slate-100">
                {data ? data.summary.footprintKg.toFixed(3) : "—"}
              </p>
              <p className="mt-3 font-mono text-sm text-emerald-300">
                {data ? formatKg(data.summary.averageConversationFootprintKg) : "—"} avg per conversation
              </p>
            </article>

            <article className="rounded-xl border border-slate-800 bg-gradient-to-r from-slate-900/90 to-slate-800/80 p-5">
              <p className="text-sm text-slate-400">Conversations</p>
              <p className="mt-2 text-4xl font-semibold text-slate-100">
                {data ? formatNumber(data.summary.conversationCount) : "—"}
              </p>
              <p className="mt-3 flex items-center gap-2 font-mono text-sm text-amber-300">
                <Users className="h-4 w-4" />
                Active filter: {selectedUserLabel}
              </p>
            </article>
          </div>

          <div className="mt-6 rounded-xl border border-slate-800 bg-gradient-to-r from-slate-900/95 to-slate-800/75 p-4">
            <div className="flex h-36 items-end gap-2 md:gap-3">
              {topKpiBars.map((heightRatio, index) => (
                <div
                  key={`kpi-bar-${index}`}
                  className="flex-1 rounded-md bg-gradient-to-t from-emerald-700/70 via-emerald-600/70 to-emerald-400/80"
                  style={{ height: `${Math.round(heightRatio * 100)}%` }}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-700/70 bg-slate-900/55 p-4 shadow-[0_15px_45px_rgba(2,6,23,0.55)]">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[220px] flex-1">
              <label htmlFor="user-filter" className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                Filter by User
              </label>
              <select
                id="user-filter"
                value={selectedUserId}
                onChange={(event) => {
                  const nextUserId = event.target.value
                  setSelectedUserId(nextUserId)
                  void loadData(nextUserId)
                }}
                className="h-11 w-full rounded-xl border border-slate-600 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-cyan-400"
              >
                <option value="all">All users</option>
                {(data?.availableUsers ?? []).map((user) => (
                  <option key={user.userId} value={user.userId}>
                    {user.userName} ({user.userId})
                  </option>
                ))}
              </select>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
              {data ? `Last updated ${formatDate(data.generatedAt)}` : "Loading dataset..."}
            </div>
          </div>
          {data?.proofOfConceptSingleUser ? (
            <p className="mt-3 text-xs text-slate-400">
              Proof-of-concept mode: currently one user is available, but this filter is wired for multi-user growth.
            </p>
          ) : null}
          {error ? (
            <p className="mt-3 rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-700/70 bg-slate-900/55 p-4 shadow-[0_15px_45px_rgba(2,6,23,0.55)]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Live Controls</h2>
              <p className="text-xs text-slate-400">
                Set routing/compression behavior and hard stop user prompts when limits are reached.
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-xl border border-slate-700/70 bg-slate-950/55 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Model Routing Knobs</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="routing-sensitivity" className="mb-1 block text-xs text-slate-300">
                    Routing Sensitivity (0-100)
                  </label>
                  <input
                    id="routing-sensitivity"
                    type="number"
                    min={0}
                    max={100}
                    value={controlDraft.routingSensitivity}
                    onChange={(event) =>
                      setControlDraft((current) => ({
                        ...current,
                        routingSensitivity: clampControlValue(Number(event.target.value)),
                      }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-600 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                  />
                </div>
                <div>
                  <label htmlFor="history-compression" className="mb-1 block text-xs text-slate-300">
                    History Compression (0-100)
                  </label>
                  <input
                    id="history-compression"
                    type="number"
                    min={0}
                    max={100}
                    value={controlDraft.historyCompression}
                    onChange={(event) =>
                      setControlDraft((current) => ({
                        ...current,
                        historyCompression: clampControlValue(Number(event.target.value)),
                      }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-600 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void updateKnobs()}
                  disabled={isSavingControls}
                  className="inline-flex items-center rounded-xl border border-cyan-500/70 bg-cyan-500/15 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSavingControls ? "Saving..." : "Save Knobs"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setControlDraft({
                      routingSensitivity: 55,
                      historyCompression: 50,
                    })
                  }
                  disabled={isSavingControls}
                  className="inline-flex items-center rounded-xl border border-slate-600/80 bg-slate-900/70 px-3 py-2 text-sm font-medium text-slate-100 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Reset Draft
                </button>
              </div>
            </article>

            <article className="rounded-xl border border-slate-700/70 bg-slate-950/55 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">User Prompt Cutoff</p>
              <p className="mt-2 text-xs text-slate-300">
                {selectedUserId === "all"
                  ? "Select a user above to set a threshold."
                  : selectedUserThreshold !== null
                    ? `Current threshold for ${selectedUserLabel}: ${formatNumber(selectedUserThreshold)} prompts`
                    : `No cutoff currently set for ${selectedUserLabel}.`}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {selectedUserMetric
                  ? `Current stored prompts: ${formatNumber(selectedUserMetric.promptCount)}`
                  : "Prompt count unavailable for current selection."}
              </p>
              <div className="mt-2 inline-flex items-center rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-xs">
                <span className={selectedUserKnobsLocked ? "text-rose-300" : "text-emerald-300"}>
                  {selectedUserId === "all"
                    ? "Knob lock: select a user"
                    : selectedUserKnobsLocked
                      ? "Knobs locked by admin"
                      : "Knobs unlocked"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div className="min-w-[180px] flex-1">
                  <label htmlFor="prompt-threshold" className="mb-1 block text-xs text-slate-300">
                    Prompt Threshold
                  </label>
                  <input
                    id="prompt-threshold"
                    type="number"
                    min={1}
                    step={1}
                    value={thresholdInput}
                    onChange={(event) => setThresholdInput(event.target.value)}
                    disabled={selectedUserId === "all" || isSavingThreshold}
                    placeholder="e.g. 250"
                    className="h-11 w-full rounded-xl border border-slate-600 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void updateThreshold(false)}
                  disabled={selectedUserId === "all" || isSavingThreshold}
                  className="inline-flex h-11 items-center rounded-xl border border-amber-400/60 bg-amber-500/15 px-3 text-sm font-medium text-amber-100 transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSavingThreshold ? "Saving..." : "Set Cutoff"}
                </button>
                <button
                  type="button"
                  onClick={() => void updateThreshold(true)}
                  disabled={selectedUserId === "all" || isSavingThreshold || selectedUserThreshold === null}
                  className="inline-flex h-11 items-center rounded-xl border border-slate-600/80 bg-slate-900/70 px-3 text-sm font-medium text-slate-100 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Clear
                </button>
              </div>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => void updateKnobLock(!selectedUserKnobsLocked)}
                  disabled={selectedUserId === "all" || isSavingControls}
                  className="inline-flex h-10 items-center rounded-xl border border-slate-600/80 bg-slate-900/70 px-3 text-sm font-medium text-slate-100 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {selectedUserKnobsLocked ? "Unlock User Knobs" : "Lock User Knobs"}
                </button>
              </div>
            </article>
          </div>

          {controlsStatus ? (
            <p className="mt-3 rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              {controlsStatus}
            </p>
          ) : null}
          {controlsError ? (
            <p className="mt-3 rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {controlsError}
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-700/70 bg-slate-900/55 p-4 shadow-[0_15px_45px_rgba(2,6,23,0.55)]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-100">Usage by Conversation</h2>
            <p className="text-xs text-slate-400">Heuristic estimate from stored conversation text</p>
          </div>

          {isLoading ? (
            <div className="rounded-xl border border-slate-700/70 bg-slate-950/50 px-4 py-6 text-sm text-slate-400">
              Loading conversation metrics...
            </div>
          ) : hasRows ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-700/70 text-xs uppercase tracking-[0.12em] text-slate-400">
                    <th className="px-3 py-3 font-medium">Conversation</th>
                    <th className="px-3 py-3 font-medium">User</th>
                    <th className="px-3 py-3 font-medium">Messages</th>
                    <th className="px-3 py-3 font-medium">Tokens</th>
                    <th className="px-3 py-3 font-medium">Footprint</th>
                    <th className="px-3 py-3 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.conversations.map((conversation) => {
                    const width =
                      maxConversationFootprint > 0
                        ? Math.max(6, Math.round((conversation.footprintKg / maxConversationFootprint) * 100))
                        : 0

                    return (
                      <tr
                        key={conversation.conversationId}
                        className="border-b border-slate-800/80 text-slate-100 transition hover:bg-slate-800/35"
                      >
                        <td className="px-3 py-3 align-top">
                          <p className="font-medium text-slate-100">{conversation.title}</p>
                          <p className="text-xs text-slate-400">{conversation.conversationId}</p>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <p className="font-medium">{conversation.userName}</p>
                          <p className="text-xs text-slate-400">{conversation.userId}</p>
                        </td>
                        <td className="px-3 py-3 align-top">{formatNumber(conversation.messageCount)}</td>
                        <td className="px-3 py-3 align-top">
                          <p>{formatNumber(conversation.totalTokens)}</p>
                          <p className="text-xs text-slate-400">
                            P {formatNumber(conversation.promptTokens)} • C {formatNumber(conversation.completionTokens)}
                          </p>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <p>{formatKg(conversation.footprintKg)}</p>
                          <div className="mt-1 h-1.5 w-40 rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400"
                              style={{ width: `${width}%` }}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-3 align-top text-xs text-slate-300">{formatDate(conversation.updatedAt)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-700/70 bg-slate-950/50 px-4 py-6 text-sm text-slate-400">
              No conversation data is available for this user filter yet.
            </div>
          )}
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          {(data?.users ?? []).map((user) => (
            <article
              key={user.userId}
              className="rounded-2xl border border-slate-700/70 bg-slate-900/55 p-4 shadow-[0_12px_32px_rgba(2,6,23,0.45)]"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-100">{user.userName}</p>
                  <p className="text-xs text-slate-400">{user.userId}</p>
                </div>
                <p className="rounded-full border border-slate-600/80 bg-slate-900/80 px-2.5 py-1 text-xs text-slate-300">
                  {formatNumber(user.conversationCount)} conversations
                </p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-slate-700/70 bg-slate-950/45 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Footprint</p>
                  <p className="mt-1 font-semibold text-emerald-200">{formatKg(user.footprintKg)}</p>
                </div>
                <div className="rounded-xl border border-slate-700/70 bg-slate-950/45 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Tokens</p>
                  <p className="mt-1 font-semibold text-cyan-200">{formatNumber(user.totalTokens)}</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-400">
                Prompts: {formatNumber(user.promptCount)}
                {data?.controls.userPromptThresholds[user.userId]
                  ? ` / Cutoff ${formatNumber(data.controls.userPromptThresholds[user.userId])}`
                  : " / No cutoff"}
              </p>
              <p
                className={`mt-1 text-xs ${
                  data?.controls.lockedUserKnobs[user.userId] ? "text-rose-300" : "text-emerald-300"
                }`}
              >
                {data?.controls.lockedUserKnobs[user.userId] ? "Knobs locked" : "Knobs unlocked"}
              </p>
              <p className="mt-3 text-xs text-slate-400">Last activity: {formatDate(user.lastActiveAt)}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  )
}
