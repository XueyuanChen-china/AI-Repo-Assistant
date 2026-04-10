import { healthResponseSchema } from '@ai-repo-assistant/shared'
import type { FastifyInstance } from 'fastify'

import { getSuggestedRepoRoot } from '../services/repoServerFsService'

export async function registerHealthRoutes(app: FastifyInstance) {
  // The health endpoint also returns a suggested default repo root for the web UI.
  app.get('/api/health', async () => {
    return healthResponseSchema.parse({
      status: 'ok',
      mode: 'filesystem',
      timestamp: new Date().toISOString(),
      suggestedRoot: getSuggestedRepoRoot(),
    })
  })
}