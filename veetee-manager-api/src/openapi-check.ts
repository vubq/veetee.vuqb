import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { buildApp } from './app.js'
import { openApiArtifactPath, openApiFixtureEnvironment } from './openapi-fixture.js'

const artifact = JSON.parse(await readFile(openApiArtifactPath(), 'utf8')) as unknown
const app = await buildApp({ env: openApiFixtureEnvironment() })
await app.ready()
try {
  assert.deepEqual(app.swagger(), artifact, 'OpenAPI artifact is stale; run npm run openapi:export')
} finally {
  await app.close()
}
console.log('OpenAPI artifact is in sync with Fastify route schemas')
