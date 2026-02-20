import { promises as fs } from "node:fs"
import path from "node:path"

const DASHBOARD_CONTROLS_PATH = path.join(process.cwd(), "dedalus_stuff", "dashboard-controls.json")

export interface CarbonRoutingSettings {
  routingSensitivity: number
  historyCompression: number
}

export interface DashboardControls extends CarbonRoutingSettings {
  userPromptThresholds: Record<string, number>
  lockedUserKnobs: Record<string, boolean>
}

export const DEFAULT_USER_ID = "proof-user-1"
export const DEFAULT_USER_NAME = "Proof User"

export const DEFAULT_DASHBOARD_CONTROLS: DashboardControls = {
  routingSensitivity: 55,
  historyCompression: 50,
  userPromptThresholds: {},
  lockedUserKnobs: {},
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  const rounded = Math.round(value)
  if (rounded < min) return min
  if (rounded > max) return max
  return rounded
}

function asFiniteInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value)
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed || !/^-?\d+$/.test(trimmed)) {
      return null
    }
    const parsed = Number.parseInt(trimmed, 10)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

export function sanitizeDashboardUserId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const sanitized = value.trim().replace(/[^a-zA-Z0-9_-]/g, "")
  return sanitized.length > 0 ? sanitized : null
}

function sanitizeRoutingSetting(value: unknown, fallback: number): number {
  const parsed = asFiniteInteger(value)
  if (parsed === null) {
    return fallback
  }
  return clampInt(parsed, 0, 100)
}

function sanitizePromptThreshold(value: unknown): number | null {
  if (value === null) {
    return null
  }
  const parsed = asFiniteInteger(value)
  if (parsed === null || parsed <= 0) {
    return null
  }
  return clampInt(parsed, 1, 1_000_000)
}

function sanitizeThresholdMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") {
    return {}
  }
  const source = raw as Record<string, unknown>
  const sanitized: Record<string, number> = {}

  for (const [rawUserId, rawThreshold] of Object.entries(source)) {
    const userId = sanitizeDashboardUserId(rawUserId)
    const threshold = sanitizePromptThreshold(rawThreshold)
    if (!userId || threshold === null) {
      continue
    }
    sanitized[userId] = threshold
  }

  return sanitized
}

function sanitizeKnobLockMap(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object") {
    return {}
  }
  const source = raw as Record<string, unknown>
  const sanitized: Record<string, boolean> = {}

  for (const [rawUserId, rawLocked] of Object.entries(source)) {
    const userId = sanitizeDashboardUserId(rawUserId)
    if (!userId || rawLocked !== true) {
      continue
    }
    sanitized[userId] = true
  }

  return sanitized
}

function sanitizeDashboardControls(raw: unknown): DashboardControls {
  if (!raw || typeof raw !== "object") {
    return {
      ...DEFAULT_DASHBOARD_CONTROLS,
      userPromptThresholds: {},
      lockedUserKnobs: {},
    }
  }
  const record = raw as Record<string, unknown>

  return {
    routingSensitivity: sanitizeRoutingSetting(
      record.routingSensitivity,
      DEFAULT_DASHBOARD_CONTROLS.routingSensitivity,
    ),
    historyCompression: sanitizeRoutingSetting(
      record.historyCompression,
      DEFAULT_DASHBOARD_CONTROLS.historyCompression,
    ),
    userPromptThresholds: sanitizeThresholdMap(record.userPromptThresholds),
    lockedUserKnobs: sanitizeKnobLockMap(record.lockedUserKnobs),
  }
}

async function writeJsonAtomic(filePath: string, payload: unknown): Promise<void> {
  const directory = path.dirname(filePath)
  await fs.mkdir(directory, { recursive: true })

  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  )
  await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8")
  try {
    await fs.rename(tempPath, filePath)
  } catch (error) {
    try {
      await fs.unlink(tempPath)
    } catch {
      // best-effort cleanup
    }
    throw error
  }
}

export async function readDashboardControls(): Promise<DashboardControls> {
  try {
    const raw = await fs.readFile(DASHBOARD_CONTROLS_PATH, "utf-8")
    return sanitizeDashboardControls(JSON.parse(raw))
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException
    if (fileError.code !== "ENOENT") {
      console.error("Failed to read dashboard controls, using defaults.", error)
    }
    return {
      ...DEFAULT_DASHBOARD_CONTROLS,
      userPromptThresholds: {},
    }
  }
}

export async function writeDashboardControls(controls: DashboardControls): Promise<DashboardControls> {
  const sanitized = sanitizeDashboardControls(controls)
  await writeJsonAtomic(DASHBOARD_CONTROLS_PATH, sanitized)
  return sanitized
}

export async function updateDashboardControls(input: {
  routingSensitivity?: unknown
  historyCompression?: unknown
  userId?: unknown
  promptThreshold?: unknown
  lockKnobs?: unknown
}): Promise<DashboardControls> {
  const current = await readDashboardControls()
  let changed = false

  if (input.routingSensitivity !== undefined) {
    const parsed = asFiniteInteger(input.routingSensitivity)
    if (parsed === null) {
      throw new Error("Routing sensitivity must be an integer between 0 and 100.")
    }
    current.routingSensitivity = clampInt(parsed, 0, 100)
    changed = true
  }

  if (input.historyCompression !== undefined) {
    const parsed = asFiniteInteger(input.historyCompression)
    if (parsed === null) {
      throw new Error("History compression must be an integer between 0 and 100.")
    }
    current.historyCompression = clampInt(parsed, 0, 100)
    changed = true
  }

  if (input.promptThreshold !== undefined) {
    const userId = sanitizeDashboardUserId(input.userId)
    if (!userId) {
      throw new Error("A valid userId is required when updating prompt thresholds.")
    }

    if (input.promptThreshold === null || input.promptThreshold === "") {
      if (Object.prototype.hasOwnProperty.call(current.userPromptThresholds, userId)) {
        delete current.userPromptThresholds[userId]
        changed = true
      }
    } else {
      const parsedThreshold = sanitizePromptThreshold(input.promptThreshold)
      if (parsedThreshold === null) {
        throw new Error("Prompt threshold must be an integer greater than 0.")
      }
      current.userPromptThresholds[userId] = parsedThreshold
      changed = true
    }
  }

  if (input.lockKnobs !== undefined) {
    const userId = sanitizeDashboardUserId(input.userId)
    if (!userId) {
      throw new Error("A valid userId is required when locking or unlocking knobs.")
    }
    if (typeof input.lockKnobs !== "boolean") {
      throw new Error("lockKnobs must be true or false.")
    }

    if (input.lockKnobs) {
      if (current.lockedUserKnobs[userId] !== true) {
        current.lockedUserKnobs[userId] = true
        changed = true
      }
    } else if (Object.prototype.hasOwnProperty.call(current.lockedUserKnobs, userId)) {
      delete current.lockedUserKnobs[userId]
      changed = true
    }
  }

  if (!changed) {
    return current
  }

  return writeDashboardControls(current)
}

export function getPromptThresholdForUser(
  controls: DashboardControls,
  userId: string | null | undefined,
): number | null {
  const sanitizedUserId = sanitizeDashboardUserId(userId)
  if (!sanitizedUserId) {
    return null
  }
  const threshold = controls.userPromptThresholds[sanitizedUserId]
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold <= 0) {
    return null
  }
  return Math.round(threshold)
}

export function areKnobsLockedForUser(
  controls: DashboardControls,
  userId: string | null | undefined,
): boolean {
  const sanitizedUserId = sanitizeDashboardUserId(userId)
  if (!sanitizedUserId) {
    return false
  }
  return controls.lockedUserKnobs[sanitizedUserId] === true
}
