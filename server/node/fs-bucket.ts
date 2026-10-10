import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { ObjectStore, PutOptions, StoredObject } from "../types";

type Metadata = { contentType?: string; contentDisposition?: string };

/**
 * R2-compatible object store backed by a local folder:
 *   <root>/objects/<key>        file bytes
 *   <root>/meta/<key>.json      content type and disposition
 */
export class FileSystemBucket implements ObjectStore {
  private readonly objects: string;
  private readonly meta: string;

  constructor(root: string) {
    this.objects = resolve(root, "objects");
    this.meta = resolve(root, "meta");
  }

  private paths(key: string) {
    if (!key || key.includes("\0") || key.split("/").some((part) => part === ".." || part === "." || part === "")) {
      throw new Error("Chiave file non valida");
    }
    const data = resolve(this.objects, key);
    if (!data.startsWith(this.objects + sep)) throw new Error("Chiave file non valida");
    return { data, meta: resolve(this.meta, `${key}.json`) };
  }

  async put(key: string, value: ReadableStream | ArrayBuffer | Uint8Array | string | Blob, options: PutOptions = {}) {
    const paths = this.paths(key);
    const bytes = new Uint8Array(await new Response(value as BodyInit).arrayBuffer());
    await mkdir(dirname(paths.data), { recursive: true });
    await mkdir(dirname(paths.meta), { recursive: true });
    await writeFile(paths.data, bytes);
    await writeFile(paths.meta, JSON.stringify(options.httpMetadata ?? {}));
  }

  async get(key: string): Promise<StoredObject | null> {
    let paths;
    try { paths = this.paths(key); } catch { return null; }
    try {
      const [bytes, info] = await Promise.all([readFile(paths.data), stat(paths.data)]);
      let metadata: Metadata = {};
      try { metadata = JSON.parse(await readFile(paths.meta, "utf8")) as Metadata; } catch { /* no metadata */ }
      return {
        body: new Uint8Array(bytes),
        httpEtag: `"${info.size.toString(16)}-${Math.round(info.mtimeMs).toString(16)}"`,
        writeHttpMetadata(headers: Headers) {
          if (metadata.contentType) headers.set("Content-Type", metadata.contentType);
          if (metadata.contentDisposition) headers.set("Content-Disposition", metadata.contentDisposition);
        },
      };
    } catch {
      return null;
    }
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      const paths = this.paths(key);
      await rm(paths.data, { force: true });
      await rm(paths.meta, { force: true });
    }
  }

  async list({ prefix }: { prefix: string; cursor?: string; limit?: number }) {
    const keys: string[] = [];
    const walk = async (directory: string) => {
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) await walk(full);
        else keys.push(relative(this.objects, full).split(sep).join("/"));
      }
    };
    await walk(this.objects);
    return { objects: keys.filter((key) => key.startsWith(prefix)).sort().map((key) => ({ key })), truncated: false };
  }
}
