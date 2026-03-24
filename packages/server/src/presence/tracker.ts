import { redis } from '../redis.js'

export interface PresenceInfo {
  userId: string
  name: string
  isAgent: boolean
  color: string
  connectedAt: number
}

const PRESENCE_TTL = 60 // seconds, refreshed on activity

const COLORS = ['#4a9eff', '#f0c040', '#50c878', '#c850c8', '#ff6b6b', '#ffa040']

export class PresenceTracker {
  private colorIdx = 0

  private nextColor(): string {
    return COLORS[this.colorIdx++ % COLORS.length]
  }

  async join(docId: string, userId: string, name: string, isAgent: boolean): Promise<PresenceInfo> {
    const info: PresenceInfo = {
      userId,
      name,
      isAgent,
      color: this.nextColor(),
      connectedAt: Date.now(),
    }
    await redis.hset(`presence:${docId}`, userId, JSON.stringify(info))
    await redis.expire(`presence:${docId}`, PRESENCE_TTL)
    return info
  }

  async leave(docId: string, userId: string): Promise<void> {
    await redis.hdel(`presence:${docId}`, userId)
  }

  async list(docId: string): Promise<PresenceInfo[]> {
    const all = await redis.hgetall(`presence:${docId}`)
    return Object.values(all).map(v => JSON.parse(v))
  }

  async heartbeat(docId: string, userId: string): Promise<void> {
    await redis.expire(`presence:${docId}`, PRESENCE_TTL)
  }
}
