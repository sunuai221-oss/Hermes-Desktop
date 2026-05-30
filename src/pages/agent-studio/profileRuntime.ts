import type { ProfileMetadata } from '../../types';

const WORKSPACE_PROFILE_NAME_ERROR =
  'Profile names can only contain letters, numbers, ".", "_" and "-".';

const WORKSPACE_PROFILE_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

type WorkspaceNodeProfileResolutionStatus =
  | 'fallback'
  | 'online'
  | 'offline'
  | 'missing'
  | 'invalid';

export type WorkspaceNodeProfileResolution = {
  requestedProfileName?: string;
  effectiveProfileName: string;
  status: WorkspaceNodeProfileResolutionStatus;
  usesFallback: boolean;
  isExplicit: boolean;
  exists: boolean;
  isOffline: boolean;
  isValid: boolean;
  differsFromCurrentProfile: boolean;
  profile?: ProfileMetadata;
  summary: string;
  detail: string;
};

type ResolveWorkspaceNodeProfileOptions = {
  requestedProfileName?: string | null;
  currentProfile: string;
  profileMetadata: ProfileMetadata[];
  fallbackProfileName?: string | null;
};

function normalizeWorkspaceNodeProfileName(value: string | null | undefined) {
  const cleaned = String(value ?? '').trim();
  return cleaned || undefined;
}

export function getWorkspaceNodeProfileNameError(value: string | null | undefined) {
  const profileName = normalizeWorkspaceNodeProfileName(value);
  if (!profileName) return null;
  return WORKSPACE_PROFILE_NAME_PATTERN.test(profileName) ? null : WORKSPACE_PROFILE_NAME_ERROR;
}

export function resolveWorkspaceNodeProfile({
  requestedProfileName,
  currentProfile,
  profileMetadata,
  fallbackProfileName,
}: ResolveWorkspaceNodeProfileOptions): WorkspaceNodeProfileResolution {
  const normalizedCurrentProfile = normalizeWorkspaceNodeProfileName(currentProfile) || 'default';
  const normalizedRequestedProfile = normalizeWorkspaceNodeProfileName(requestedProfileName);
  const effectiveFallbackProfile =
    normalizeWorkspaceNodeProfileName(fallbackProfileName) || normalizedCurrentProfile;

  if (!normalizedRequestedProfile) {
    const profile =
      profileMetadata.find(candidate => candidate.name === effectiveFallbackProfile) || undefined;
    const differsFromCurrentProfile = effectiveFallbackProfile !== normalizedCurrentProfile;
    return {
      effectiveProfileName: effectiveFallbackProfile,
      status: 'fallback',
      usesFallback: true,
      isExplicit: false,
      exists: Boolean(profile),
      isOffline: profile?.status === 'offline',
      isValid: true,
      differsFromCurrentProfile,
      profile,
      summary: `Current app profile (${effectiveFallbackProfile})`,
      detail: differsFromCurrentProfile
        ? `This run used the app profile "${effectiveFallbackProfile}" when it executed. Future fallback runs will follow the current app profile "${normalizedCurrentProfile}".`
        : `This node follows the current app profile "${effectiveFallbackProfile}". Switching profiles redirects future fallback runs.`,
    };
  }

  const validationError = getWorkspaceNodeProfileNameError(normalizedRequestedProfile);
  if (validationError) {
    return {
      requestedProfileName: normalizedRequestedProfile,
      effectiveProfileName: normalizedRequestedProfile,
      status: 'invalid',
      usesFallback: false,
      isExplicit: true,
      exists: false,
      isOffline: false,
      isValid: false,
      differsFromCurrentProfile: normalizedRequestedProfile !== normalizedCurrentProfile,
      summary: normalizedRequestedProfile,
      detail: `${validationError} This value will be rejected on save until you clear it or pick a valid profile.`,
    };
  }

  const profile =
    profileMetadata.find(candidate => candidate.name === normalizedRequestedProfile) || undefined;
  const differsFromCurrentProfile = normalizedRequestedProfile !== normalizedCurrentProfile;

  if (!profile) {
    return {
      requestedProfileName: normalizedRequestedProfile,
      effectiveProfileName: normalizedRequestedProfile,
      status: 'missing',
      usesFallback: false,
      isExplicit: true,
      exists: false,
      isOffline: false,
      isValid: true,
      differsFromCurrentProfile,
      summary: normalizedRequestedProfile,
      detail: `This node is pinned to "${normalizedRequestedProfile}", but that profile no longer exists in Hermes. Choose another profile or clear it to follow the current app profile "${normalizedCurrentProfile}".`,
    };
  }

  if (profile.status === 'offline') {
    return {
      requestedProfileName: normalizedRequestedProfile,
      effectiveProfileName: normalizedRequestedProfile,
      status: 'offline',
      usesFallback: false,
      isExplicit: true,
      exists: true,
      isOffline: true,
      isValid: true,
      differsFromCurrentProfile,
      profile,
      summary: normalizedRequestedProfile,
      detail: differsFromCurrentProfile
        ? `This node is pinned to "${normalizedRequestedProfile}", but that profile runtime is offline right now. Switching the app profile will not affect it.`
        : `This node is pinned to the current app profile "${normalizedRequestedProfile}", but that runtime is offline right now.`,
    };
  }

  return {
    requestedProfileName: normalizedRequestedProfile,
    effectiveProfileName: normalizedRequestedProfile,
    status: 'online',
    usesFallback: false,
    isExplicit: true,
    exists: true,
    isOffline: false,
    isValid: true,
    differsFromCurrentProfile,
    profile,
    summary: normalizedRequestedProfile,
    detail: differsFromCurrentProfile
      ? `This node is pinned to "${normalizedRequestedProfile}". Switching the app profile will not affect it.`
      : `This node is pinned to the current app profile "${normalizedRequestedProfile}".`,
  };
}
