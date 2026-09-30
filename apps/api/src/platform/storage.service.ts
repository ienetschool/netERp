import { Injectable, Logger } from '@nestjs/common';
import type { S3Client as S3ClientType } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';

export interface StoredObject {
  storageKey: string;
  contentHash: string;
  sizeBytes: number;
}

export interface ObjectStorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** S3-compatible driver (MinIO locally, any S3 provider in production). */
class S3Driver implements ObjectStorageDriver {
  private client?: S3ClientType;

  constructor(
    private readonly endpoint: string,
    private readonly region: string,
    private readonly bucket: string,
    private readonly accessKey: string,
    private readonly secretKey: string,
  ) {}

  private async getClient(): Promise<S3ClientType> {
    if (!this.client) {
      const { S3Client } = await import('@aws-sdk/client-s3');
      this.client = new S3Client({
        endpoint: this.endpoint,
        region: this.region,
        forcePathStyle: true,
        credentials: { accessKeyId: this.accessKey, secretAccessKey: this.secretKey },
      });
    }
    return this.client;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    await client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    const result = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Object not found: ${key}`);
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/** Local-disk driver for simple deployments without object storage. */
class LocalDriver implements ObjectStorageDriver {
  private readonly base: string;

  constructor(basePath: string) {
    this.base = resolve(basePath);
  }

  private safePath(key: string): string {
    const full = resolve(this.base, key);
    if (!full.startsWith(this.base)) {
      throw new Error('Invalid storage key (path traversal rejected)');
    }
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.safePath(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.safePath(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.safePath(key), { force: true });
  }
}

/** In-memory driver for unit tests / ephemeral sandboxes. */
export class MemoryDriver implements ObjectStorageDriver {
  private readonly objects = new Map<string, Buffer>();

  put(key: string, data: Buffer): Promise<void> {
    this.objects.set(key, Buffer.from(data));
    return Promise.resolve();
  }

  get(key: string): Promise<Buffer> {
    const data = this.objects.get(key);
    if (!data) return Promise.reject(new Error(`Object not found: ${key}`));
    return Promise.resolve(Buffer.from(data));
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  size(): number {
    return this.objects.size;
  }
}

/**
 * Storage facade. Business code depends on this class only — never on a
 * provider SDK (CLAUDE.md §26, ARCHITECTURE.md §29).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: ObjectStorageDriver;
  readonly driverName: string;

  constructor() {
    const driverName = process.env.OBJECT_STORAGE_DRIVER ?? 'memory';
    this.driverName = driverName;
    switch (driverName) {
      case 's3':
        this.driver = new S3Driver(
          process.env.OBJECT_STORAGE_ENDPOINT ?? 'http://localhost:9000',
          process.env.OBJECT_STORAGE_REGION ?? 'us-east-1',
          process.env.OBJECT_STORAGE_BUCKET ?? 'erp-documents',
          process.env.OBJECT_STORAGE_ACCESS_KEY ?? '',
          process.env.OBJECT_STORAGE_SECRET_KEY ?? '',
        );
        break;
      case 'local':
        this.driver = new LocalDriver(process.env.LOCAL_STORAGE_PATH ?? './data/documents');
        break;
      case 'memory':
      default:
        this.driver = new MemoryDriver();
        break;
    }
    this.logger.log(`Object storage driver: ${this.driverName}`);
  }

  async put(
    scope: { companyId: string },
    filename: string,
    data: Buffer,
    contentType: string,
  ): Promise<StoredObject> {
    const safeName = filename.replace(/[^\w.]+/g, '_').slice(-120);
    const storageKey = `companies/${scope.companyId}/${new Date().getUTCFullYear()}/${randomKey()}-${safeName}`;
    await this.driver.put(storageKey, data, contentType);
    return {
      storageKey,
      contentHash: createHash('sha256').update(data).digest('hex'),
      sizeBytes: data.byteLength,
    };
  }

  async get(storageKey: string): Promise<Buffer> {
    return this.driver.get(storageKey);
  }

  async delete(storageKey: string): Promise<void> {
    await this.driver.delete(storageKey);
  }
}

function randomKey(): string {
  return createHash('sha256').update(`${Date.now()}:${Math.random()}`).digest('hex').slice(0, 24);
}

export { join as joinStoragePath };
