
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID
} from "node:crypto";
import {
  createReadStream,
  createWriteStream
} from "node:fs";
import {
  mkdir,
  rename,
  rm,
  readFile,
  writeFile
} from "node:fs/promises";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const ALGORITHM = "aes-256-gcm";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface EncryptedFileMetadata {
  storageKey: string;
  iv: Buffer;
  tag: Buffer;
  sizeBytes: number;
  sha256: string;
}

export class EncryptedStorage {
  private readonly root: string;
  private readonly supabaseUrl: string | undefined;
  private readonly serviceRoleKey: string | undefined;
  private readonly bucket: string;
  private key: Buffer | undefined;

  constructor() {
    this.root = path.resolve(
      process.env.VAULT_STORAGE_DIR ??
        path.join(process.cwd(), "storage")
    );
    this.supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
    this.serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "trustvault-encrypted";
  }

  private get cloudEnabled(): boolean {
    return Boolean(this.supabaseUrl && this.serviceRoleKey);
  }

  private getKey(): Buffer {
    if (this.key) {
      return this.key;
    }

    const encodedKey = process.env.VAULT_ENCRYPTION_KEY;

    if (!encodedKey || !/^[0-9a-fA-F]{64}$/.test(encodedKey)) {
      throw new Error(
        "VAULT_ENCRYPTION_KEY must be a 32-byte hex key"
      );
    }

    this.key = Buffer.from(encodedKey, "hex");
    return this.key;
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  private getPath(storageKey: string): string {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        storageKey
      )
    ) {
      throw new Error("Invalid storage identifier");
    }

    return path.join(this.root, `${storageKey}.enc`);
  }

  private objectPath(storageKey: string): string {
    this.getPath(storageKey);
    return `${storageKey}.enc`;
  }

  private async cloudRequest(storageKey: string, init: RequestInit): Promise<Response> {
    if (!this.cloudEnabled) throw new Error("Supabase Storage is not configured");
    const response = await fetch(
      `${this.supabaseUrl}/storage/v1/object/${encodeURIComponent(this.bucket)}/${encodeURIComponent(this.objectPath(storageKey))}`,
      { ...init, headers: { apikey: this.serviceRoleKey!, Authorization: `Bearer ${this.serviceRoleKey!}`, ...init.headers } }
    );
    if (!response.ok) throw new Error(`SUPABASE_STORAGE_${response.status}`);
    return response;
  }

  private async uploadCiphertext(storageKey: string, encryptedPath: string): Promise<void> {
    const body = await readFile(encryptedPath);
    await this.cloudRequest(storageKey, { method: "POST", headers: { "Content-Type": "application/octet-stream", "x-upsert": "false" }, body });
  }

  private async downloadCiphertext(storageKey: string, targetPath: string): Promise<void> {
    const response = await this.cloudRequest(storageKey, { method: "GET" });
    await writeFile(targetPath, Buffer.from(await response.arrayBuffer()), { flag: "wx", mode: 0o600 });
  }

  async encrypt(
    input: Readable,
    maxBytes = MAX_FILE_BYTES
  ): Promise<EncryptedFileMetadata> {
    const key = this.getKey();
    await this.ensureRoot();

    const storageKey = randomUUID();
    const finalPath = this.getPath(storageKey);
    const tempPath = `${finalPath}.${randomUUID()}.tmp`;
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const hash = createHash("sha256");
    let sizeBytes = 0;

    const inspect = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sizeBytes += chunk.length;

        if (sizeBytes > maxBytes) {
          callback(new Error("FILE_TOO_LARGE"));
          return;
        }

        hash.update(chunk);
        callback(null, chunk);
      }
    });

    try {
      await pipeline(
        input,
        inspect,
        cipher,
        createWriteStream(tempPath, {
          flags: "wx",
          mode: 0o600
        })
      );

      await rename(tempPath, finalPath);

      if (this.cloudEnabled) {
        try {
          await this.uploadCiphertext(storageKey, finalPath);
          await rm(finalPath, { force: true });
        } catch (error) {
          // Do not leave an object reachable without a committed document row.
          await this.cloudRequest(storageKey, { method: "DELETE" }).catch(() => {});
          throw error;
        }
      }

      return {
        storageKey,
        iv,
        tag: cipher.getAuthTag(),
        sizeBytes,
        sha256: hash.digest("hex")
      };
    } catch (error) {
      await rm(tempPath, { force: true });
      await rm(finalPath, { force: true });
      throw error;
    }
  }

  async decryptToTemporaryFile(
    storageKey: string,
    iv: Buffer,
    tag: Buffer,
    expectedSha256: string
  ): Promise<string> {
    const key = this.getKey();
    await this.ensureRoot();

    const localEncryptedPath = this.getPath(storageKey);
    const encryptedPath = this.cloudEnabled
      ? path.join(this.root, `${randomUUID()}.ciphertext.tmp`)
      : localEncryptedPath;
    const plaintextPath = path.join(
      this.root,
      `${randomUUID()}.plaintext.tmp`
    );

    try {
      if (this.cloudEnabled) await this.downloadCiphertext(storageKey, encryptedPath);
      return await this.decryptPathToTemporaryFile(
        encryptedPath,
        plaintextPath,
        key,
        iv,
        tag,
        expectedSha256
      );
    } finally {
      if (this.cloudEnabled) await rm(encryptedPath, { force: true });
    }
  }

  private async decryptPathToTemporaryFile(
    encryptedPath: string,
    plaintextPath: string,
    key: Buffer,
    iv: Buffer,
    tag: Buffer,
    expectedSha256: string
  ): Promise<string> {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const hash = createHash("sha256");
    const inspect = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      }
    });

    try {
      await pipeline(
        createReadStream(encryptedPath),
        decipher,
        inspect,
        createWriteStream(plaintextPath, { flags: "wx", mode: 0o600 })
      );
      if (hash.digest("hex") !== expectedSha256) {
        throw new Error("CONTENT_INTEGRITY_FAILURE");
      }
      return plaintextPath;
    } catch {
      await rm(plaintextPath, { force: true });
      throw new Error("CONTENT_INTEGRITY_FAILURE");
    }
  }

  async verifyLocalCiphertext(
    storageKey: string,
    iv: Buffer,
    tag: Buffer,
    sha256: string
  ): Promise<void> {
    await this.ensureRoot();
    const plaintextPath = path.join(this.root, `${randomUUID()}.plaintext.tmp`);
    const verifiedPath = await this.decryptPathToTemporaryFile(
      this.getPath(storageKey),
      plaintextPath,
      this.getKey(),
      iv,
      tag,
      sha256
    );
    await rm(verifiedPath, { force: true });
  }

  async deleteEncryptedFile(storageKey: string): Promise<void> {
    if (this.cloudEnabled) {
      await this.cloudRequest(storageKey, { method: "DELETE" });
      return;
    }
    await rm(this.getPath(storageKey), { force: true });
  }

  async migrateLocalCiphertext(storageKey: string, iv: Buffer, tag: Buffer, sha256: string): Promise<void> {
    if (!this.cloudEnabled) throw new Error("Supabase Storage is not configured");
    const localPath = this.getPath(storageKey);
    // Never persist a legacy ciphertext remotely until its local ciphertext,
    // metadata, authenticated decryption, and plaintext hash agree.
    await this.verifyLocalCiphertext(storageKey, iv, tag, sha256);
    await this.uploadCiphertext(storageKey, localPath).catch(async (error) => {
      if (!(error instanceof Error) || !error.message.endsWith("409")) throw error;
    });
    const plaintextPath = await this.decryptToTemporaryFile(storageKey, iv, tag, sha256);
    await rm(plaintextPath, { force: true });
  }
}
