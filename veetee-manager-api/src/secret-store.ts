import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface SecretValueStore {
  put(referenceId: string, value: string): Promise<{ version: number }>
  delete(referenceId: string): Promise<void>
}

interface EncryptedEntry {
  version: number
  iv: string
  tag: string
  ciphertext: string
}

interface SecretFile {
  schemaVersion: 1
  entries: Record<string, EncryptedEntry>
}

/** Values are encrypted at rest; callers never receive a read method. */
export class EncryptedFileSecretStore implements SecretValueStore {
  private readonly key: Buffer
  private writeTail: Promise<void> = Promise.resolve()

  constructor(private readonly path: string, masterMaterial: string) {
    this.key = createHash('sha256').update(masterMaterial).digest()
  }

  async put(referenceId: string, value: string): Promise<{ version: number }> {
    if (!value) throw new Error('secret value cannot be empty')
    return this.withWriteLock(async () => {
      const file = await this.load()
      const previous = file.entries[referenceId]
      const version = (previous?.version ?? 0) + 1
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', this.key, iv)
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()
      file.entries[referenceId] = { version, iv: iv.toString('base64url'), tag: tag.toString('base64url'), ciphertext: ciphertext.toString('base64url') }
      await this.save(file)
      return { version }
    })
  }

  async delete(referenceId: string): Promise<void> {
    await this.withWriteLock(async () => {
      const file = await this.load()
      if (!file.entries[referenceId]) return
      delete file.entries[referenceId]
      await this.save(file)
    })
  }

  /** Test/maintenance probe: validates ciphertext without returning plaintext. */
  async verify(referenceId: string): Promise<boolean> {
    const file = await this.load()
    const entry = file.entries[referenceId]
    if (!entry) return false
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(entry.iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64url'))
    decipher.update(Buffer.from(entry.ciphertext, 'base64url'))
    decipher.final()
    return true
  }

  private async load(): Promise<SecretFile> {
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8')) as Partial<SecretFile>
      if (raw.schemaVersion !== 1 || !raw.entries || typeof raw.entries !== 'object') throw new Error('invalid encrypted secret store')
      return { schemaVersion: 1, entries: raw.entries as Record<string, EncryptedEntry> }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, entries: {} }
      throw error
    }
  }

  private async save(file: SecretFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    await writeFile(temporary, JSON.stringify(file), { encoding: 'utf8', mode: 0o600 })
    await chmod(temporary, 0o600)
    await rename(temporary, this.path)
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeTail
    let release!: () => void
    this.writeTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}
