import { useCallback, useState } from 'react';
import type { ChangeEvent, ClipboardEvent } from 'react';
import * as apiClient from '../../../api';
import type { ImageAttachment } from '../../../types';
import { extractImageFilesFromClipboard, normalizeImageFile } from '../../../hooks/chatMediaUtils';

interface UseChatUploadsOptions {
  maxImages: number;
}

export function useChatUploads({ maxImages }: UseChatUploadsOptions) {
  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const attachImageFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    const availableSlots = maxImages - imageAttachments.length;
    const selectedFiles = files.filter(file => file.type.startsWith('image/')).slice(0, availableSlots);

    if (selectedFiles.length === 0) {
      setImageError(imageAttachments.length >= maxImages ? `Maximum ${maxImages} images per message.` : 'No usable image detected.');
      return;
    }

    setUploadingImages(true);
    setImageError(null);

    try {
      const uploaded = await Promise.all(selectedFiles.map(async file => {
        const normalized = await normalizeImageFile(file);
        const response = await apiClient.images.upload(normalized.fileName, normalized.dataUrl);
        return { ...response.data, dataUrl: normalized.dataUrl, width: normalized.width, height: normalized.height } satisfies ImageAttachment;
      }));
      setImageAttachments(current => [...current, ...uploaded]);
    } catch (error) {
      console.error(error);
      setImageError('Could not add the image.');
    } finally {
      setUploadingImages(false);
    }
  }, [imageAttachments.length, maxImages]);

  const removeImage = useCallback((id: string) => {
    setImageAttachments(current => current.filter(item => item.id !== id));
  }, []);

  const clearImageAttachments = useCallback(() => {
    setImageAttachments([]);
  }, []);

  const handlePaste = useCallback(async (event: ClipboardEvent<HTMLElement>) => {
    const files = extractImageFilesFromClipboard(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    await attachImageFiles(files);
  }, [attachImageFiles]);

  const handleFileSelection = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    await attachImageFiles(files);
    event.target.value = '';
  }, [attachImageFiles]);

  return {
    imageAttachments,
    uploadingImages,
    imageError,
    setImageError,
    attachImageFiles,
    removeImage,
    clearImageAttachments,
    handlePaste,
    handleFileSelection,
  };
}
