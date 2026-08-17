/**
 * Sequential batch upload with per-file outcomes.
 *
 * Every upload surface in the app took `files?.[0]` and uploaded one file per
 * click, which made attaching a set of assets — a mode still for each day of a
 * campaign, say — a dozen separate round trips through the file picker.
 *
 * Two properties matter more than raw speed here:
 *
 *  1. **Partial success is the normal case.** One oversized or wrong-typed file
 *     in a selection of ten must not discard the other nine. Each file gets its
 *     own result, and the caller is handed both lists.
 *  2. **Sequential, not parallel.** Each file is read into a base64 data URL,
 *     which inflates it by roughly a third and holds it in memory for the
 *     duration of the request. Uploading a 24MB-limit selection concurrently
 *     multiplies peak memory by the batch size and can trip request limits, so
 *     the small wall-clock win is not worth it.
 */

export type BatchFailure = { name: string; reason: string };

export type BatchResult<T> = { uploaded: T[]; failed: BatchFailure[] };

export type BatchProgress = { done: number; total: number; current: string };

export interface BatchOptions<T> {
  /** Reject a file before any work is done. Return a reason, or null to accept. */
  validate?: (file: File) => string | null;
  /** Called before each file starts, so the UI can show "3 of 7 — name.jpg". */
  onProgress?: (progress: BatchProgress) => void;
  /** Called after each success, so results can stream into the list as they land. */
  onUploaded?: (result: T, file: File) => void;
}

/** Read a File as a data URL, the shape the media endpoint accepts. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

export async function uploadSequentially<T>(
  files: File[],
  uploadOne: (file: File) => Promise<T>,
  options: BatchOptions<T> = {},
): Promise<BatchResult<T>> {
  const uploaded: T[] = [];
  const failed: BatchFailure[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    options.onProgress?.({ done: i, total: files.length, current: file.name });

    const invalid = options.validate?.(file) ?? null;
    if (invalid) {
      failed.push({ name: file.name, reason: invalid });
      continue;
    }

    try {
      const result = await uploadOne(file);
      uploaded.push(result);
      options.onUploaded?.(result, file);
    } catch (error) {
      failed.push({
        name: file.name,
        reason: error instanceof Error ? error.message : 'Upload failed.',
      });
    }
  }

  options.onProgress?.({ done: files.length, total: files.length, current: '' });
  return { uploaded, failed };
}

/** "3 of 7 · queue-01.jpg" — the label shown while a batch runs. */
export function progressLabel(progress: BatchProgress | null): string {
  if (!progress || progress.total === 0) return 'UPLOADING…';
  if (progress.done >= progress.total) return 'FINISHING…';
  const name = progress.current.length > 22 ? `${progress.current.slice(0, 21)}…` : progress.current;
  return `UPLOADING ${progress.done + 1}/${progress.total} · ${name}`;
}

/** One-line summary after a batch settles, or null when everything succeeded. */
export function failureSummary(failed: BatchFailure[]): string | null {
  if (!failed.length) return null;
  const head = failed
    .slice(0, 3)
    .map((f) => `${f.name}: ${f.reason}`)
    .join(' · ');
  return failed.length > 3
    ? `${failed.length} files failed — ${head} · and ${failed.length - 3} more`
    : `${failed.length === 1 ? '1 file' : `${failed.length} files`} failed — ${head}`;
}
