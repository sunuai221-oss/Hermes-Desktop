export type Live2DAvatarId = 'shizuku' | 'mashiro' | string;
export type ModelVersion = 'cubism2' | 'cubism4';

export interface Live2DAvatarDefinition {
  id: Live2DAvatarId;
  label: string;
  description: string;
  modelUrl: string;
  modelVersion: ModelVersion;
  fit?: {
    padding?: number;
    zoom?: number;
    offsetX?: number;
    offsetY?: number;
  };
  idleMotion: string;
  activeMotions: string[];
  tapMotion: string;
  idleExpression: string;
  activeExpression: string;
  tapExpression: string;
  /** If true, this model was imported by the user (not built-in). */
  isUserModel?: boolean;
  /** For Cubism 4 models: path to the .model3.json (relative to modelUrl). */
  model3Url?: string;
}

export const LIVE2D_AVATARS: Live2DAvatarDefinition[] = [
  {
    id: 'shizuku',
    label: 'Shizuku',
    description: 'Orange-haired Cubism 2 model, bundled locally.',
    modelUrl: '/live2d-models/shizuku/shizuku.model.json',
    modelVersion: 'cubism2',
    idleMotion: 'idle',
    activeMotions: ['flick_head', 'shake'],
    tapMotion: 'tap_body',
    idleExpression: 'f01',
    activeExpression: 'f02',
    tapExpression: 'f03',
  },
  {
    id: 'mashiro',
    label: 'Mashiro',
    description: 'Mashiro Cubism 2 model, imported locally for offline use.',
    modelUrl: '/live2d-models/mashiro/ryoufuku.model.json',
    modelVersion: 'cubism2',
    fit: {
      padding: 0.96,
      zoom: 1.22,
      offsetY: -0.12,
    },
    idleMotion: 'idle',
    activeMotions: ['flick_head', 'tap_body', 'talk'],
    tapMotion: 'tap_body',
    idleExpression: 'f01.exp.json',
    activeExpression: 'f05.exp.json',
    tapExpression: 'f08.exp.json',
  },
  {
    id: 'cubism4-sample',
    label: 'Cubism 4 Sample',
    description: 'Place a .model3.json in public/live2d-models/ and reference it here.',
    modelUrl: '/live2d-models/sample/sample.model3.json',
    modelVersion: 'cubism4',
    fit: {
      padding: 0.9,
      zoom: 1,
      offsetY: 0,
    },
    idleMotion: 'Idle',
    activeMotions: ['Tap'],
    tapMotion: 'Tap',
    idleExpression: '',
    activeExpression: '',
    tapExpression: '',
  },
];

export const DEFAULT_LIVE2D_AVATAR_ID: Live2DAvatarId = 'shizuku';

export function getLive2DAvatarDefinition(id: string | null | undefined) {
  return LIVE2D_AVATARS.find(avatar => avatar.id === id) || LIVE2D_AVATARS[0];
}

export function isCubism4Model(modelUrl: string): boolean {
  return modelUrl.toLowerCase().endsWith('.model3.json');
}
