import type { ContextReferenceAttachment, ImageAttachment } from '../types';

export function toReferenceString(ref: ContextReferenceAttachment): string {
  if (ref.kind === 'diff' || ref.kind === 'staged') return `@${ref.kind}`;
  if (ref.kind === 'git') return `@git:${ref.value}`;
  return `@${ref.kind}:${ref.value}`;
}

export function buildVisionContent(text: string, images: ImageAttachment[]): string {
  if (images.length === 0) return text;
  const imageBlock = images
    .map((img, i) => `![image-${i + 1}](${img.path || img.dataUrl})`)
    .join('\n');
  return `${text}\n\n${imageBlock}`;
}

export function extractImageFilesFromClipboard(data: DataTransfer): File[] {
  const files: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

export async function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function extractVoiceAudioFileName(audioUrl: string): string | null {
  const normalized = String(audioUrl || '').trim();
  if (!normalized) return null;
  try {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1';
    const url = new URL(normalized, baseUrl);
    const match = url.pathname.match(/\/api\/voice\/audio\/([^/]+)$/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export async function convertDataUrlToPng(dataUrl: string): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas unsupported'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve({ dataUrl: canvas.toDataURL('image/png'), width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export async function readImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

export async function normalizeImageFile(file: File): Promise<{ fileName: string; dataUrl: string; width: number; height: number }> {
  const raw = await readBlobAsDataUrl(file);
  if (file.type === 'image/png') {
    const dims = await readImageDimensions(raw);
    return { fileName: file.name, dataUrl: raw, ...dims };
  }
  const converted = await convertDataUrlToPng(raw);
  const baseName = file.name.replace(/\.[^.]+$/, '');
  return { fileName: `${baseName}.png`, ...converted };
}
