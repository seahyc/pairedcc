import dotenv from 'dotenv'
import { resolve } from 'path'
import { z } from 'zod'

dotenv.config({ path: resolve(process.cwd(), '.env') })
// Also try root .env if running from packages/server
dotenv.config({ path: resolve(process.cwd(), '../../.env') })

const envSchema = z.object({
  DATABASE_URL: z.string(),
  REDIS_URL: z.string(),
  JWT_SECRET: z.string().min(16),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  SMTP_URL: z.string().optional(),
  BASE_URL: z.string().default('http://localhost:3000'),
  PORT: z.coerce.number().default(3000),
})

export const config = envSchema.parse(process.env)
export type Config = z.infer<typeof envSchema>
