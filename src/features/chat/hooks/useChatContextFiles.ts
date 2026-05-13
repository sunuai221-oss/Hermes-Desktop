import { useCallback, useEffect, useMemo, useState } from 'react';
import * as apiClient from '../../../api';
import type { ContextReferenceAttachment, ResolvedContextReference } from '../../../types';
import { toReferenceString } from '../../../hooks/chatMediaUtils';

interface ReferenceTemplate {
  kind: ContextReferenceAttachment['kind'];
  label: string;
  placeholder: string;
}

interface UseChatContextFilesOptions {
  referenceTemplates: ReferenceTemplate[];
}

function buildAttachedContextText(resolvedAttachments: ResolvedContextReference[]): string {
  if (resolvedAttachments.length === 0) return '';
  const blocks = resolvedAttachments.map(item => {
    const header = `### ${item.ref}`;
    const warning = item.warning ? `Warning: ${item.warning}\n` : '';
    const body = item.content || '[no content extracted]';
    return `${header}\n${warning}${body}`;
  }).join('\n\n');
  return `--- Attached Context ---\n\n${blocks}`;
}

export function useChatContextFiles({ referenceTemplates }: UseChatContextFilesOptions) {
  const [attachments, setAttachments] = useState<ContextReferenceAttachment[]>([]);
  const [newAttachmentKind, setNewAttachmentKind] = useState<ContextReferenceAttachment['kind']>('file');
  const [newAttachmentValue, setNewAttachmentValue] = useState('');
  const [resolvedAttachments, setResolvedAttachments] = useState<ResolvedContextReference[]>([]);
  const [resolvingRefs, setResolvingRefs] = useState(false);

  const totalResolvedChars = useMemo(
    () => resolvedAttachments.reduce((acc, item) => acc + item.charCount, 0),
    [resolvedAttachments],
  );

  const canAddReference = useMemo(() => {
    if (newAttachmentKind === 'diff' || newAttachmentKind === 'staged') {
      return !attachments.some(item => item.kind === newAttachmentKind);
    }
    return Boolean(newAttachmentValue.trim());
  }, [attachments, newAttachmentKind, newAttachmentValue]);

  const addAttachment = useCallback(() => {
    const template = referenceTemplates.find(item => item.kind === newAttachmentKind);
    if (!template) return;

    if ((newAttachmentKind === 'diff' || newAttachmentKind === 'staged') && attachments.some(item => item.kind === newAttachmentKind)) {
      return;
    }

    if ((newAttachmentKind === 'file' || newAttachmentKind === 'folder' || newAttachmentKind === 'git' || newAttachmentKind === 'url') && !newAttachmentValue.trim()) {
      return;
    }

    const value = newAttachmentKind === 'diff' || newAttachmentKind === 'staged'
      ? template.label
      : newAttachmentValue.trim();

    setAttachments(current => [...current, { id: `${newAttachmentKind}_${Date.now()}`, kind: newAttachmentKind, value }]);
    setNewAttachmentValue('');
  }, [attachments, newAttachmentKind, newAttachmentValue, referenceTemplates]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(current => current.filter(item => item.id !== id));
    setResolvedAttachments([]);
    setResolvingRefs(false);
  }, []);

  const clearContextReferences = useCallback(() => {
    setAttachments([]);
    setResolvedAttachments([]);
    setResolvingRefs(false);
  }, []);

  useEffect(() => {
    if (attachments.length === 0) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setResolvingRefs(true);
    });
    const refStrings = attachments.map(toReferenceString);

    apiClient.contextReferences.resolve(refStrings)
      .then(res => {
        if (cancelled) return;
        const results = Array.isArray(res.data) ? res.data : [];
        setResolvedAttachments(results.map((result: ResolvedContextReference, index: number) => ({
          ref: result.ref || refStrings[index],
          kind: result.kind || attachments[index]?.kind || 'file',
          label: result.label || attachments[index]?.value || '',
          content: result.content || '[no content]',
          charCount: result.charCount || 0,
          warning: result.warning,
        })));
        setResolvingRefs(false);
      })
      .catch(() => {
        if (cancelled) return;
        setResolvedAttachments(attachments.map((ref, index) => ({
          ref: refStrings[index],
          kind: ref.kind,
          label: ref.value,
          content: '[Resolution failed]',
          charCount: 0,
          warning: 'Could not resolve this reference.',
        })));
        setResolvingRefs(false);
      });

    return () => {
      cancelled = true;
    };
  }, [attachments]);

  const attachedContext = useMemo(
    () => buildAttachedContextText(resolvedAttachments),
    [resolvedAttachments],
  );

  const buildAttachedContext = useCallback(() => attachedContext, [attachedContext]);

  return {
    attachments,
    newAttachmentKind,
    newAttachmentValue,
    resolvedAttachments,
    resolvingRefs,
    totalResolvedChars,
    canAddReference,
    attachedContext,
    setNewAttachmentKind,
    setNewAttachmentValue,
    addAttachment,
    removeAttachment,
    clearContextReferences,
    buildAttachedContext,
  };
}
