import { buildApp } from './app.js'
import { readEnvironment } from './config.js'

const env = readEnvironment()
const app = await buildApp({ env })
await app.listen({ host: env.VEETEE_API_HOST, port: env.VEETEE_API_PORT })
