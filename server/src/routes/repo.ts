import {
  repoFileQuerySchema,
  repoFileResponseSchema,
  repoTreeQuerySchema,
  repoTreeResponseSchema,
} from '@ai-repo-assistant/shared'
import type { FastifyInstance } from 'fastify'

import { readRepoFile, readRepoTree, resolveRepoRoot } from '../services/repoServerFsService'

export async function registerRepoRoutes(app: FastifyInstance) {
  // Day 2 replaces the mock tree endpoint with real local filesystem traversal.
  app.get('/api/repo/tree', async (request, reply) => {
    try {
      const query = repoTreeQuerySchema.parse(request.query)
      const repoRoot = await resolveRepoRoot(query.root)
      const nodes = await readRepoTree(repoRoot)

      return repoTreeResponseSchema.parse({
        root: repoRoot,
        nodes,
      })
    } catch (error) {
      return reply.status(400).send({
        message: error instanceof Error ? error.message : 'Failed to read the repository tree.',
      })
    }
  })

  // The file preview endpoint now reads a real file from disk using repo root + relative path.
  app.get('/api/repo/file', async (request, reply) => {
    try {
      const query = repoFileQuerySchema.parse(request.query)
      const repoRoot = await resolveRepoRoot(query.root)
      const file = await readRepoFile(repoRoot, query.path)

      return repoFileResponseSchema.parse({ file })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read the file.'
      return reply.status(400).send({ message })
    }
  })
}