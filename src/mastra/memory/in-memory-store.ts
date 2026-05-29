export type MemoryRole = "user" | "agent" | "system" | "tool"

export interface MemoryMessage {
  role: MemoryRole
  content: string
  createdAt: string
  metadata?: Record<string, unknown>
}

export interface SessionMemory {
  sessionId: string
  createdAt: string
  updatedAt: string
  messages: MemoryMessage[]
  facts: Record<string, unknown>
}

export class InMemoryStore {
  private readonly sessions = new Map<string, SessionMemory>()

  /**
   * 获取或创建指定会话的存储记录
   * 若会话不存在则自动创建新的空会话
   *
   * @param sessionId 会话标识，默认 "default"
   * @returns 该会话的存储记录
   */
  getOrCreate(sessionId = "default"): SessionMemory {
    const existing = this.sessions.get(sessionId)
    if (existing) {
      return existing
    }

    const now = new Date().toISOString()
    const session: SessionMemory = {
      sessionId,
      createdAt: now,
      updatedAt: now,
      messages: [],
      facts: {},
    }
    this.sessions.set(sessionId, session)
    return session
  }

  /**
   * 向指定会话添加一条消息记录
   *
   * @param sessionId 会话标识
   * @param role 消息角色：user/agent/system/tool
   * @param content 消息内容
   * @param metadata 可选的附加元数据
   * @returns 创建的消息记录
   */
  addMessage(
    sessionId: string,
    role: MemoryRole,
    content: string,
    metadata?: Record<string, unknown>
  ): MemoryMessage {
    const session = this.getOrCreate(sessionId)
    const message: MemoryMessage = {
      role,
      content,
      createdAt: new Date().toISOString(),
      metadata,
    }
    session.messages.push(message)
    session.updatedAt = message.createdAt
    return message
  }

  /**
   * 设置指定会话的键值对存储
   *
   * @param sessionId 会话标识
   * @param key 键名
   * @param value 值
   */
  setFact(sessionId: string, key: string, value: unknown): void {
    const session = this.getOrCreate(sessionId)
    session.facts[key] = value
    session.updatedAt = new Date().toISOString()
  }

  /**
   * 获取指定会话中某键对应的值
   *
   * @param sessionId 会话标识
   * @param key 键名
   * @returns 存储的值，若不存在则返回 undefined
   */
  getFact<T>(sessionId: string, key: string): T | undefined {
    return this.getOrCreate(sessionId).facts[key] as T | undefined
  }

  summarize(sessionId: string, messageLimit = 12): string {
    const session = this.getOrCreate(sessionId)
    const facts = Object.entries(session.facts)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join("\n")
    const messages = session.messages
      .slice(-messageLimit)
      .map((message) => `[${message.role}] ${message.content}`)
      .join("\n")

    return [facts ? `Facts:\n${facts}` : "", messages ? `Recent messages:\n${messages}` : ""]
      .filter(Boolean)
      .join("\n\n")
  }
}

export const memoryStore = new InMemoryStore()
