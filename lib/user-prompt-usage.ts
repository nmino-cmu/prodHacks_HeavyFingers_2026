import { promises as fs } from "node:fs"
import path from "node:path"
import { DEFAULT_USER_ID, sanitizeDashboardUserId } from "@/lib/dashboard-controls"

const CONVERSATIONS_DIR = path.join(process.cwd(), "dedalus_stuff", "conversations")

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function extractUserIdFromNotes(notes: unknown): string | null {
  const notesText = asString(notes)
  if (!notesText) {
    return null
  }

  const idMatch = /(?:^|\s)(?:user[_ -]?id)\s*[:=]\s*([a-zA-Z0-9_-]{2,64})/i.exec(notesText)
  return sanitizeDashboardUserId(idMatch?.[1] ?? null)
}

function resolveConversationUserId(payload: Record<string, unknown>): string {
  const conversation =
    payload.conversation && typeof payload.conversation === "object"
      ? (payload.conversation as Record<string, unknown>)
      : {}
  const messages =
    payload.messages && typeof payload.messages === "object"
      ? (payload.messages as Record<string, unknown>)
      : {}

  const fromConversation =
    sanitizeDashboardUserId(asString(conversation.userId)) ??
    sanitizeDashboardUserId(asString(conversation.user_id)) ??
    sanitizeDashboardUserId(asString(conversation.ownerId)) ??
    sanitizeDashboardUserId(asString(conversation.owner_id))

  return fromConversation ?? extractUserIdFromNotes(messages.notes) ?? DEFAULT_USER_ID
}

function countPromptMessages(rawMessages: unknown): number {
  if (!Array.isArray(rawMessages)) {
    return 0
  }

  let promptCount = 0
  for (const rawMessage of rawMessages) {
    if (!rawMessage || typeof rawMessage !== "object") {
      continue
    }

    const entry = rawMessage as Record<string, unknown>
    const role = asString(entry.role)
    const text = asString(entry.text)
    if (role === "user" && text) {
      promptCount += 1
    }
  }

  return promptCount
}

export async function getStoredPromptCountForUser(userId: string): Promise<number> {
  const sanitizedUserId = sanitizeDashboardUserId(userId)
  if (!sanitizedUserId) {
    return 0
  }

  await fs.mkdir(CONVERSATIONS_DIR, { recursive: true })
  const files = await fs.readdir(CONVERSATIONS_DIR)
  const jsonFiles = files.filter((fileName) => fileName.endsWith(".json"))

  let totalPromptCount = 0

  for (const fileName of jsonFiles) {
    const filePath = path.join(CONVERSATIONS_DIR, fileName)
    try {
      const raw = await fs.readFile(filePath, "utf-8")
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object") {
        continue
      }

      const payload = parsed as Record<string, unknown>
      if (resolveConversationUserId(payload) !== sanitizedUserId) {
        continue
      }

      const messagesContainer =
        payload.messages && typeof payload.messages === "object"
          ? (payload.messages as Record<string, unknown>)
          : {}
      totalPromptCount += countPromptMessages(messagesContainer.messages)
    } catch (error) {
      console.error(`Skipping unreadable conversation while counting prompts: ${fileName}`, error)
    }
  }

  return totalPromptCount
}
