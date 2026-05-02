// XHR-based upload so we can read upload progress events
// (fetch() doesn't expose request body progress in browsers).

import { z } from "zod";

export type UploadProgressHandler = (pct: number) => void;

export class UploadError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "UploadError";
  }
}

export function uploadFile<T>(
  url: string,
  file: File,
  schema: z.ZodType<T>,
  onProgress?: UploadProgressHandler,
  fieldName: string = "file",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const fd = new FormData();
    fd.append(fieldName, file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.withCredentials = true;

    xhr.upload.addEventListener("progress", (evt) => {
      if (onProgress && evt.lengthComputable) {
        onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let detail = xhr.statusText || "Upload failed";
        try {
          const body = JSON.parse(xhr.responseText);
          if (body?.detail) detail = body.detail;
        } catch {
          /* not JSON, use statusText */
        }
        reject(new UploadError(xhr.status, detail));
        return;
      }
      try {
        const parsed = schema.parse(JSON.parse(xhr.responseText));
        resolve(parsed);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    xhr.addEventListener("error", () => reject(new UploadError(0, "Network error")));
    xhr.addEventListener("abort", () => reject(new UploadError(0, "Upload aborted")));

    xhr.send(fd);
  });
}
