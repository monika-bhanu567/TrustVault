import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { EncryptedStorage } from "../src/storage/encrypted-storage.js";

const TEST_KEY = "0123456789abcdef".repeat(4);

let testDirectory: string;
let previousStorageDir: string | undefined;
let previousEncryptionKey: string | undefined;
let storage: EncryptedStorage;

beforeEach(async () => {
  previousStorageDir = process.env.VAULT_STORAGE_DIR;
  previousEncryptionKey = process.env.VAULT_ENCRYPTION_KEY;

  testDirectory = await mkdtemp(
    path.join(tmpdir(), "trustvault-storage-test-")
  );

  process.env.VAULT_STORAGE_DIR = testDirectory;
  process.env.VAULT_ENCRYPTION_KEY = TEST_KEY;

  storage = new EncryptedStorage();
});

afterEach(async () => {
  await rm(testDirectory, { recursive: true, force: true });

  if (previousStorageDir === undefined) {
    delete process.env.VAULT_STORAGE_DIR;
  } else {
    process.env.VAULT_STORAGE_DIR = previousStorageDir;
  }

  if (previousEncryptionKey === undefined) {
    delete process.env.VAULT_ENCRYPTION_KEY;
  } else {
    process.env.VAULT_ENCRYPTION_KEY = previousEncryptionKey;
  }
});

describe("EncryptedStorage", () => {
  it("encrypts content and decrypts the original bytes", async () => {
    const original = Buffer.from(
      "TrustVault storage encryption test",
      "utf8"
    );

    const encrypted = await storage.encrypt(
      Readable.from([original])
    );

    expect(encrypted.sizeBytes).toBe(original.length);
    expect(encrypted.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(encrypted.iv).toHaveLength(12);
    expect(encrypted.tag).toHaveLength(16);

    const encryptedBytes = await readFile(
      path.join(testDirectory, `${encrypted.storageKey}.enc`)
    );

    expect(encryptedBytes.equals(original)).toBe(false);

    const plaintextPath = await storage.decryptToTemporaryFile(
      encrypted.storageKey,
      encrypted.iv,
      encrypted.tag,
      encrypted.sha256
    );

    try {
      const decrypted = await readFile(plaintextPath);
      expect(decrypted.equals(original)).toBe(true);
    } finally {
      await rm(plaintextPath, { force: true });
    }
  });

  it("rejects a missing encryption key", async () => {
    delete process.env.VAULT_ENCRYPTION_KEY;

    await expect(
      storage.encrypt(Readable.from(["content"]))
    ).rejects.toThrow(/VAULT_ENCRYPTION_KEY/);
  });

  it("rejects a malformed encryption key", async () => {
    process.env.VAULT_ENCRYPTION_KEY = "not-a-valid-hex-key";

    await expect(
      storage.encrypt(Readable.from(["content"]))
    ).rejects.toThrow(/VAULT_ENCRYPTION_KEY/);
  });

  it("rejects content that exceeds the supplied size limit and cleans up", async () => {
    await expect(
      storage.encrypt(Readable.from(["12345"]), 4)
    ).rejects.toThrow("FILE_TOO_LARGE");

    const files = await readdir(testDirectory);
    expect(files).toEqual([]);
  });

  it("rejects corrupted ciphertext and removes temporary plaintext", async () => {
    const encrypted = await storage.encrypt(
      Readable.from(["original secure content"])
    );

    const encryptedPath = path.join(
      testDirectory,
      `${encrypted.storageKey}.enc`
    );

    const encryptedBytes = await readFile(encryptedPath);
    encryptedBytes[0] = encryptedBytes[0] ^ 0xff;
    await writeFile(encryptedPath, encryptedBytes);

    await expect(
      storage.decryptToTemporaryFile(
        encrypted.storageKey,
        encrypted.iv,
        encrypted.tag,
        encrypted.sha256
      )
    ).rejects.toThrow("CONTENT_INTEGRITY_FAILURE");

    const remainingFiles = await readdir(testDirectory);

    expect(
      remainingFiles.some((name) => name.endsWith(".plaintext.tmp"))
    ).toBe(false);
  });
});
