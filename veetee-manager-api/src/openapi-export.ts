import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildApp } from './app.js'
import { openApiArtifactPath, openApiFixtureEnvironment } from './openapi-fixture.js'

const output = openApiArtifactPath()
const app = await buildApp({ env: openApiFixtureEnvironment() })
await app.ready()
await mkdir(resolve(output, '..'), { recursive: true })
await writeFile(output, `${JSON.stringify(app.swagger(), null, 2)}\n`, 'utf8')
await app.close()
console.log(`OpenAPI exported to ${output}`)
