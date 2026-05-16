/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Live2DAvatarDefinition, ModelVersion } from './live2dAvatars';

// ── Types ───────────────────────────────────────────────────────────

type Live2DWindow = Window & {
  Live2D?: unknown;
  Live2DCubismCore?: unknown;
};

interface PixiModules {
  Application: any;
  Live2DModel: any;
}

interface ViewInstance {
  app: any;
  canvas: HTMLCanvasElement;
  model: any;
}

// ── Constants ───────────────────────────────────────────────────────

const CUBISM2_RUNTIME_URLS = [
  '/live2d-runtime/live2d.min.js',
  'https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js',
];

const CUBISM4_RUNTIME_URLS = [
  '/live2d-runtime/live2dcubismcore.min.js',
  'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js',
];

// ── Singleton Manager ───────────────────────────────────────────────

class Live2DRuntimeManager {
  private static instance: Live2DRuntimeManager;

  // Cubism 2
  private cubism2Modules: PixiModules | null = null;
  private cubism2LoadPromise: Promise<void> | null = null;

  // Cubism 4
  private cubism4Modules: PixiModules | null = null;
  private cubism4CorePromise: Promise<void> | null = null;

  static getInstance(): Live2DRuntimeManager {
    if (!Live2DRuntimeManager.instance) {
      Live2DRuntimeManager.instance = new Live2DRuntimeManager();
    }
    return Live2DRuntimeManager.instance;
  }

  // ── Generic script loader ────────────────────────────────────────

  private loadScript(src: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[data-live2d-runtime="${src}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.live2dRuntime = src;
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        reject(new Error(`Failed to load ${src}`));
      };
      document.head.appendChild(script);
    });
  }

  // ── Cubism 2 runtime ────────────────────────────────────────────

  private hasCubism2Runtime(): boolean {
    return Boolean((window as Live2DWindow).Live2D);
  }

  private async ensureCubism2Core(): Promise<void> {
    if (this.hasCubism2Runtime()) return;
    if (this.cubism2LoadPromise) return this.cubism2LoadPromise;

    this.cubism2LoadPromise = (async () => {
      let lastError: unknown = null;
      for (const url of CUBISM2_RUNTIME_URLS) {
        try {
          await this.loadScript(url);
          if (this.hasCubism2Runtime()) return;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error('Live2D Cubism 2 runtime could not be loaded.');
    })().catch((error) => {
      this.cubism2LoadPromise = null;
      throw error;
    });

    return this.cubism2LoadPromise;
  }

  private async ensureCubism2Runtime(): Promise<PixiModules> {
    if (this.cubism2Modules) return this.cubism2Modules;

    await this.ensureCubism2Core();

    const [{ Application, Ticker }, { Live2DModel }] = await Promise.all([
      import('pixi.js'),
      import('pixi-live2d-display/cubism2'),
    ]);

    Live2DModel.registerTicker(Ticker as any);
    this.cubism2Modules = { Application, Live2DModel };
    return this.cubism2Modules;
  }

  // ── Cubism 4/5 runtime ─────────────────────────────────────────

  private hasCubism4Runtime(): boolean {
    return Boolean((window as Live2DWindow).Live2DCubismCore);
  }

  private async ensureCubism4Core(): Promise<void> {
    if (this.hasCubism4Runtime()) return;
    if (this.cubism4CorePromise) return this.cubism4CorePromise;

    this.cubism4CorePromise = (async () => {
      let lastError: unknown = null;
      for (const url of CUBISM4_RUNTIME_URLS) {
        try {
          await this.loadScript(url);
          if (this.hasCubism4Runtime()) return;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error('Live2D Cubism 4 core could not be loaded.');
    })().catch((error) => {
      this.cubism4CorePromise = null;
      throw error;
    });

    return this.cubism4CorePromise;
  }

  private async ensureCubism4Runtime(): Promise<PixiModules> {
    if (this.cubism4Modules) return this.cubism4Modules;

    await this.ensureCubism4Core();

    const [{ Application, Ticker }, { Live2DModel }] = await Promise.all([
      import('pixi.js'),
      import('pixi-live2d-display/cubism4'),
    ]);

    Live2DModel.registerTicker(Ticker as any);
    this.cubism4Modules = { Application, Live2DModel };
    return this.cubism4Modules;
  }

  // ── View management ─────────────────────────────────────────────

  async createView(
    modelUrl: string,
    _avatar: Live2DAvatarDefinition,
    width: number,
    height: number,
    version: ModelVersion = 'cubism2',
  ): Promise<ViewInstance> {
    const { Application, Live2DModel } = version === 'cubism4'
      ? await this.ensureCubism4Runtime()
      : await this.ensureCubism2Runtime();

    const canvas = document.createElement('canvas');
    canvas.id = 'live2d-canvas-' + Math.random().toString(36).substr(2, 9);

    const app = new Application({
      view: canvas,
      width,
      height,
      backgroundAlpha: 0,
      antialias: true,
    }) as any;

    canvas.style.width = '100%';
    canvas.style.height = '100%';

    const model = await Live2DModel.from(modelUrl, { autoInteract: false }) as any;

    app.stage.addChild(model);
    app.render();

    return { app, canvas, model };
  }

  destroyView(view: ViewInstance): void {
    if (!view) return;
    try {
      const { model, app, canvas } = view;
      if (model) {
        model.removeAllListeners?.();
        model.parent?.removeChild?.(model);
        model.destroy?.({ children: true, texture: false, baseTexture: false });
      }
      if (app) {
        app.stage?.removeChildren?.();
        app.destroy?.(true, { children: false, texture: false, baseTexture: false });
      }
      if (canvas?.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    } catch {
      // ignore cleanup errors
    }
  }

  // ── Utilities ───────────────────────────────────────────────────

  fitModelToCanvas(model: any, width: number, height: number, avatar: Live2DAvatarDefinition): void {
    model.scale.set(1);
    model.update?.(0);

    const bounds = model.getLocalBounds?.();
    const boundsWidth = Number(bounds?.width) > 0 ? Number(bounds.width) : Number(model.width) || 1;
    const boundsHeight = Number(bounds?.height) > 0 ? Number(bounds.height) : Number(model.height) || 1;
    const boundsX = Number(bounds?.x) || 0;
    const boundsY = Number(bounds?.y) || 0;
    const fit = avatar.fit || {};
    const padding = fit.padding ?? (width < 80 || height < 90 ? 0.96 : 0.9);
    const scale = Math.min(width / boundsWidth, height / boundsHeight) * padding * (fit.zoom ?? 1);

    model.scale.set(scale);
    model.pivot.set(boundsX + boundsWidth / 2, boundsY + boundsHeight / 2);
    model.position.set(
      width / 2 + width * (fit.offsetX ?? 0),
      height / 2 + height * (fit.offsetY ?? 0),
    );
  }

  playMotion(model: any, group: string, variants = 3): void {
    if (!model?.motion) return;
    const motion = model.motion(group, Math.floor(Math.random() * variants));
    if (motion && typeof motion.catch === 'function') {
      motion.catch(() => {});
    }
  }

  setExpression(model: any, name: string): void {
    const expression = model?.internalModel?.expressionManager?.setExpression?.(name);
    if (expression && typeof expression.catch === 'function') {
      expression.catch(() => {});
    }
  }
}

export { Live2DRuntimeManager };
export type { ViewInstance };
