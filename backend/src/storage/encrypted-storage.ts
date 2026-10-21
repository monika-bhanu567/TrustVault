
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
  rm
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
  private key: Buffer | undefined;

  constructor() {
    this.root = path.resolve(
      process.env.VAULT_STORAGE_DIR ??
        path.join(process.cwd(), "storage")
    );
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

    const encryptedPath = this.getPath(storageKey);
    const plaintextPath = path.join(
      this.root,
      `${randomUUID()}.plaintext.tmp`
    );

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
        createWriteStream(plaintextPath, {
          flags: "wx",
          mode: 0o600
        })
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

  async deleteEncryptedFile(storageKey: string): Promise<void> {
    await rm(this.getPath(storageKey), { force: true });
  }
}
