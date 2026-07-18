export type StoredAttachment = { name: string; type: string; dataUrl: string };

export const ATTACHMENT_QUOTA_BYTES = 4_000_000;

export function serializeStoredAttachments(items: StoredAttachment[]): string | null {
  const raw = JSON.stringify(items);
  if (raw.length > ATTACHMENT_QUOTA_BYTES) {
    return null;
  }
  return raw;
}

export function deserializeStoredAttachments(raw: string | null): StoredAttachment[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is StoredAttachment =>
        Boolean(item) &&
        typeof item.name === 'string' &&
        typeof item.type === 'string' &&
        typeof item.dataUrl === 'string',
    );
  } catch {
    return [];
  }
}
