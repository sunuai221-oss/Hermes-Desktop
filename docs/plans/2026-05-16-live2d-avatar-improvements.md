# Live2D Avatar Improvements — Plan d'implémentation

> **Version:** 1.0.0
> **Priorité:** P1 → P4 (ordre d'exécution)
> **Dépendances:** P3 dépend de P1 (manager partagé) ; P2 dépend du canal audio existant

## Résumé des 4 phases

| Phase | Titre | Effort | Dépend de |
|---|---|---|---|
| **P1** | Runtime singleton + cache de modèles | ½ journée | — |
| **P2** | Lipsync avec le TTS | 1 journée | P1 |
| **P3** | Animations RAF + visibility | ½ journée | P1 |
| **P4** | Gestion d'erreurs gracieuse | 2h | — |

---

# P1 — Runtime singleton `Live2DRuntimeManager`

## Objectif

Extraire la gestion du runtime Pixi + Cubism 2 dans un singleton global, avec cache de modèles par `modelUrl` et compteur de références. Plus de `new Application()` par montage.

## Architecture

```
Live2DRuntimeManager (singleton)
├── pixi: PIXI.Application     ← une seule instance
├── modelCache: Map<string, ModelEntry>
│   └── ModelEntry { model, refCount, canvas }
├── getOrCreateModel(modelUrl, avatarDef) → { model, canvas }
└── releaseModel(modelUrl) → void
```

## Backlog

### P1-T1: Créer `live2dRuntime.ts` — classe singleton

**Files:**
- Create: `src/features/companions/live2dRuntime.ts`

La classe `Live2DRuntimeManager` encapsule :
- Le chargement unique des modules Pixi (déjà partiellement fait dans `loadCubism2Live2D`)
- La création unique de `PIXI.Application` avec `backgroundAlpha: 0`
- Un cache `modelCache: Map<string, { model: any; canvas: HTMLCanvasElement; refCount: number }>`
- `getOrCreateModel(modelUrl, avatarDef, width, height) → { model, canvas, app }`
- `releaseModel(modelUrl)` → décrémente refCount, détruit si refCount === 0

```typescript
// Signature clé
class Live2DRuntimeManager {
  private static instance: Live2DRuntimeManager;
  private pixiModules: { Application: any; Live2DModel: any } | null = null;
  private app: any = null;
  private modelCache = new Map<string, {
    model: any;
    canvas: HTMLCanvasElement;
    refCount: number;
  }>();

  static getInstance(): Live2DRuntimeManager;
  async ensureRuntime(): Promise<{ Application: any; Live2DModel: any }>;
  async getOrCreateModel(
    modelUrl: string,
    avatar: Live2DAvatarDefinition,
    width: number,
    height: number
  ): Promise<{ model: any; canvas: HTMLCanvasElement; app: any }>;
  releaseModel(modelUrl: string): void;
  destroy(): void;
}
```

### P1-T2: Refactorer `ShizukuAvatar` pour utiliser le manager

**Files:**
- Modify: `src/components/avatar/ShizukuAvatar.tsx`

Remplacer l'initialisation locale :
```typescript
// AVANT
const { Application, Live2DModel } = await loadCubism2Live2D();
const canvas = createCanvas();
const app = new Application({ view: canvas, width, height, ... });
// charge model, etc.

// APRÈS
const runtime = Live2DRuntimeManager.getInstance();
const { model, canvas, app } = await runtime.getOrCreateModel(avatar.modelUrl, avatar, width, height);
```

Important : le `useEffect` cleanup appelle `runtime.releaseModel(avatar.modelUrl)`.

Le refactoring doit :
- Garder les refs (`modelRef`, `appRef`, `containerRef`) identiques
- Garder les interactions (pointertap, focus, etc.) identiques
- Garder l'API `ShizukuAvatarRef` inchangée
- Supprimer les helper functions devenues inutiles : `createCanvas`, `loadCubism2Live2D`, `ensureCubism2Runtime`, `loadScript`, `hasCubism2Runtime`, `CUBISM2_RUNTIME_URLS`, `destroyLive2DInstance`, `destroyPixiApp`

**Attention au cleanup partagé :** Ne PAS détruire les textures quand `releaseModel` est appelé si un autre composant utilise encore le même modèle. Le `refCount` protège contre ça.

### P1-T3: Adapter `DetachedShizukuOverlay` et `ChatMessages` au manager partagé

**Files:**
- Modify: `src/components/avatar/DetachedShizukuOverlay.tsx`
- Modify: `src/components/chat/ChatMessages.tsx` (via `AssistantAvatar`)

Aucun changement d'API nécessaire — `ShizukuAvatar` reste le même de l'extérieur. Vérifier que :
- Le detached overlay ET l'avatar du chat peuvent être visibles simultanément sans crash
- Les deux partagent le même canvas Pixi sous-jacent

**Vérification :**
- Ouvrir l'app, invoquer le detached overlay
- Ouvrir un chat avec messages (AssistantAvatar visible)
- Les deux avatars s'affichent sans doublon de canvas
- DevTools → Elements : un seul canvas Pixi dans le DOM

### P1-T4: Supprimer les fonctions redondantes

**Files:**
- Modify: `src/components/avatar/ShizukuAvatar.tsx`
- Delete functions: `createCanvas`, `loadCubism2Live2D`, `ensureCubism2Runtime`, `loadScript`, `hasCubism2Runtime`, `CUBISM2_RUNTIME_URLS`, `destroyLive2DInstance`, `destroyPixiApp`

Ces fonctions sont toutes internalisées dans `Live2DRuntimeManager`.

---

# P2 — Lipsync avec NeuTTS

## Objectif

Faire bouger la bouche de l'avatar quand le TTS parle, en temps réel, via le paramètre Cubism `ParamMouthOpenY`.

## Architecture

```
VoicePipeline (playAudio, playAudioAndWait)
  │ émet 'hermes:voice:speaking-start' / 'hermes:voice:speaking-end'
  ▼
DetachedShizukuOverlay / ChatMessages
  │ écoute les events → appelle ref.startTalking() / stopTalking()
  ▼
ShizukuAvatarRef
  ├── startTalking(intensity?) → anime ParamMouthOpenY via RAF loop
  └── stopTalking() → retour à idle expression
```

## Backlog

### P2-T1: Ajouter `startTalking` / `stopTalking` à `ShizukuAvatarRef`

**Files:**
- Modify: `src/components/avatar/ShizukuAvatar.tsx`

Dans l'interface `ShizukuAvatarRef` :
```typescript
export interface ShizukuAvatarRef {
  // ... existing methods ...
  startTalking: (intensity?: number) => void;
  stopTalking: () => void;
}
```

Implémentation :
```typescript
// Dans useImperativeHandle
startTalking: (intensity = 0.7) => {
  const model = modelRef.current;
  if (!model?.internalModel?.coreModel) return;

  // Démarrer une RAF loop qui oscille ParamMouthOpenY
  const coreModel = model.internalModel.coreModel;
  if (talkingRafRef.current) return; // déjà en train de parler

  const talkLoop = () => {
    if (!modelRef.current || !talkingRef.current) return;
    // Oscillation sinusoïdale pour un mouvement naturel
    const t = performance.now() / 100;
    const value = Math.max(0, Math.sin(t) * intensity);
    coreModel.setParamValue('ParamMouthOpenY', value);
    // Si le modèle a ParamMouthForm, l'osciller aussi
    if (coreModel.getParamIndex('ParamMouthForm') >= 0) {
      coreModel.setParamValue('ParamMouthForm', Math.max(0, Math.sin(t * 0.7 + 1) * intensity * 0.6));
    }
    talkingRafRef.current = requestAnimationFrame(talkLoop);
  };
  talkingRef.current = true;
  talkingRafRef.current = requestAnimationFrame(talkLoop);
}

stopTalking: () => {
  talkingRef.current = false;
  if (talkingRafRef.current) {
    cancelAnimationFrame(talkingRafRef.current);
    talkingRafRef.current = null;
  }
  // Revenir à l'expression idle ou active
  const model = modelRef.current;
  if (model?.internalModel?.coreModel) {
    model.internalModel.coreModel.setParamValue('ParamMouthOpenY', 0);
  }
}
```

### P2-T2: Émettre des événements vocaux depuis le pipeline audio

**Files:**
- Modify: `src/hooks/chatVoice.ts`

Dans `playAudio` (ligne 87) et `playAudioAndWait` (ligne 107), dispatcher un CustomEvent :

```typescript
const dispatchVoiceEvent = (type: 'start' | 'end') => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('hermes:voice:speaking', {
      detail: { state: type }
    }));
  }
};
```

Placer `dispatchVoiceEvent('start')` juste avant `await audio.play()`.
Placer `dispatchVoiceEvent('end')` dans le `handleEnded` callback.

### P2-T3: Connecter le detached overlay aux événements vocaux

**Files:**
- Modify: `src/components/avatar/DetachedShizukuOverlay.tsx`

```typescript
const shizukuRef = useRef<ShizukuAvatarRef>(null);

useEffect(() => {
  const handleVoice = (event: Event) => {
    const detail = (event as CustomEvent<{ state: string }>).detail;
    if (detail.state === 'start') {
      shizukuRef.current?.startTalking();
    } else {
      shizukuRef.current?.stopTalking();
    }
  };
  window.addEventListener('hermes:voice:speaking', handleVoice);
  return () => window.removeEventListener('hermes:voice:speaking', handleVoice);
}, []);
```

Ajouter `ref={shizukuRef}` sur le `<ShizukuAvatar>` dans le detached overlay.

### P2-T4: Connecter l'avatar du chat aux événements vocaux

**Files:**
- Modify: `src/components/chat/ChatMessages.tsx`

Même pattern que P2-T3 mais dans le composant `AssistantAvatar`. Le `ShizukuAvatar` dans le chat doit aussi remuer la bouche quand le TTS parle.

**Alternative plus simple :** Utiliser `message.audioUrl` — détecter quand un message a un `audioUrl` et qu'il est en lecture.

### P2-T5: Gérer l'arrêt vocal au vanish/navigation

**Files:**
- Modify: `src/components/avatar/DetachedShizukuOverlay.tsx`

Quand l'utilisateur cache l'overlay (`updateState({ visible: false })`) ou change de page, appeler `stopTalking()` pour éviter un lipsync fantôme.

---

# P3 — Animations RAF + Visibility API

## Objectif

Remplacer les `setInterval` par un `requestAnimationFrame` loop avec pause sur `document.hidden`, et utiliser les fichiers `.pose.json` pour des transitions plus naturelles.

## Backlog

### P3-T1: Créer un hook `useAnimationLoop`

**Files:**
- Create: `src/features/companions/useAnimationLoop.ts`

```typescript
export function useAnimationLoop(
  callback: (deltaMs: number) => void,
  active: boolean
) {
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const callbackRef = useRef(callback);

  useEffect(() => { callbackRef.current = callback; }, [callback]);

  useEffect(() => {
    if (!active) return;

    const loop = (time: number) => {
      if (document.hidden) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const delta = lastTimeRef.current ? time - lastTimeRef.current : 16;
      lastTimeRef.current = time;
      callbackRef.current(delta);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      lastTimeRef.current = 0;
    };
  }, [active]);
}
```

### P3-T2: Remplacer les `setInterval` dans `ShizukuAvatar`

**Files:**
- Modify: `src/components/avatar/ShizukuAvatar.tsx`

Remplacer :
```typescript
// AVANT
activityTimerRef.current = window.setInterval(() => {
  playMotion(modelRef.current, avatarRef.current.idleMotion);
}, 9000);
```

Par :
```typescript
// APRÈS — via useAnimationLoop
useAnimationLoop((deltaMs) => {
  if (loadState !== 'ready') return;
  totalElapsedRef.current += deltaMs;

  const interval = active ? 2400 : 9000;
  if (totalElapsedRef.current >= interval) {
    totalElapsedRef.current = 0;
    if (active) {
      const motions = avatarRef.current.activeMotions;
      playMotion(modelRef.current, motions[Math.floor(Math.random() * motions.length)]);
    } else {
      playMotion(modelRef.current, avatarRef.current.idleMotion);
    }
  }
}, loadState === 'ready');
```

### P3-T3: Lire et appliquer les `.pose.json` pour les transitions

**Files:**
- Modify: `src/features/companions/live2dRuntime.ts` (ou un nouveau helper)

Les fichiers `.pose.json` existent déjà (`shizuku.pose.json`, `ryoufuku.pose.json`). Ils définissent des groupes d'idle avec des transitions fluides entre poses.

Créer une fonction utilitaire qui charge le `.pose.json` et applique les transitions :
```typescript
async function loadPoseData(modelUrl: string): Promise<PoseGroup[]> {
  const baseUrl = modelUrl.replace(/\/[^/]+\.model\.json$/, '');
  const poseUrl = modelUrl.replace(/\.model\.json$/, '.pose.json');
  const response = await fetch(poseUrl);
  const data = await response.json();
  return data; // structure: [{ "idle_0": { "file": "motions/idle_00.mtn" }, ... }, ...]
}
```

Utiliser les groupes de poses pour animer plutôt que des motions aléatoires. Cela donne des transitions plus naturelles.

### P3-T4: Supprimer les anciennes refs de timer

**Files:**
- Modify: `src/components/avatar/ShizukuAvatar.tsx`

Supprimer `activityTimerRef` et son cleanup dans le `useEffect` return. Remplacer par le nouveau système RAF.

---

# P4 — Gestion d'erreurs gracieuse

## Objectif

Au lieu d'un silence + icône `Bot` quand Live2D échoue, afficher un état clair avec message, retry, et option de désactivation.

## Backlog

### P4-T1: Ajouter des états d'erreur granulaires à `ShizukuAvatar`

**Files:**
- Modify: `src/components/avatar/ShizukuAvatar.tsx`

Étendre `loadState` pour distinguer les erreurs :
```typescript
type Live2DLoadState = 'loading' | 'ready' | 'runtime-error' | 'model-error' | 'canvas-error';
```

Afficher pour chaque état un message différent :
```typescript
const errorMessages: Record<string, string> = {
  'runtime-error': 'Live2D Cubism 2 runtime introuvable. Vérifie public/live2d-runtime/.',
  'model-error': `Modèle "${avatar.label}" impossible à charger. Fichier .model.json corrompu ?`,
  'canvas-error': 'Impossible de créer le canvas WebGL. Navigateur trop ancien ?',
};
```

### P4-T2: Ajouter un bouton Retry

**Files:**
- Modify: `src/components/avatar/ShizukuAvatar.tsx`

Quand `loadState` est une erreur, rendre un `<button>` Retry :
```typescript
{loadState.endsWith('-error') && (
  <button
    onClick={() => { setLoadState('loading'); init(); }}
    className="text-xs text-primary hover:underline"
  >
    Retry
  </button>
)}
```

### P4-T3: Exposer `onRetry` dans les composants parents

**Files:**
- Modify: `src/components/avatar/ShizukuAvatar.tsx`
- Modify: `src/components/avatar/DetachedShizukuOverlay.tsx`
- Modify: `src/components/chat/ChatMessages.tsx`

Ajouter `onRetry?: () => void` à `ShizukuAvatarProps`. Les parents (DetachedShizukuOverlay, AssistantAvatar) peuvent afficher un message "Live2D error — [Retry] [Disable]" au lieu du fallback muet.

### P4-T4: Ajouter une option de config pour désactiver Live2D

**Files:**
- Modify: `src/pages/ConfigPage.tsx`
- Modify: `src/types.ts`
- Modify: `src/components/avatar/ShizukuAvatar.tsx`

Dans `types.ts` :
```typescript
display?: {
  tool_progress?: string;
  background_process_notifications?: string;
  live2d_enabled?: boolean;  // ← AJOUT
};
```

Dans `ShizukuAvatar`, ne rien rendre si `live2d_enabled === false` (via une prop ou un contexte global).

Dans `ConfigPage`, ajouter un toggle dans la section Display :
```tsx
<Toggle
  label="Live2D avatar"
  checked={config.display?.live2d_enabled ?? true}
  onChange={v => update(['display', 'live2d_enabled'], v)}
/>
```

### P4-T5: Logger les erreurs pour debugging

**Files:**
- Modify: `src/components/avatar/ShizukuAvatar.tsx`

Au lieu de `console.error('Failed to load Shizuku Live2D model:', e)` :
```typescript
console.error(
  '[Live2D] Failed to load avatar:', {
    avatar: avatar.label,
    modelUrl: avatar.modelUrl,
    error: e instanceof Error ? { message: e.message, stack: e.stack?.split('\n').slice(0, 3).join('\n') } : String(e),
    userAgent: navigator.userAgent.slice(0, 80),
    webglSupport: detectWebGLSupport(),
  }
);
```

Ajouter une fonction utilitaire :
```typescript
function detectWebGLSupport(): string {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return 'no-webgl';
    const info = (gl as any).getExtension('WEBGL_debug_renderer_info');
    return info ? (gl as any).getParameter(info.UNMASKED_RENDERER_WEBGL) : 'webgl-ok';
  } catch { return 'error'; }
}
```

---

# Dépendances entre phases

```
P1 (Runtime singleton)
├── requis par P2 (lipsync → partage le model ref)
├── requis par P3 (RAF → travaille sur le manager unique)
└── indépendant de P4

P2 (Lipsync)
└── utilise le ShizukuAvatarRef existant, pas de dépendance forte

P3 (RAF)
└── utilise le manager de P1

P4 (Erreurs)
└── indépendant — peut être fait en premier ou en parallèle
```

## Ordre d'exécution recommandé

1. **P4** (le plus simple, impact UX immédiat, sans risque)
2. **P1** (refactor sensible — tester rigoureusement)
3. **P3** (dépend de P1)
4. **P2** (dépend de P1, plus complexe)
