import type { Radar2dManifest } from './radar-2d.ts';

export async function installRadar2dObservation(options: {
  readonly manifest: Radar2dManifest;
  readonly enabled: boolean;
  readonly installOverlay: (manifest: Radar2dManifest, enabled: boolean) => Promise<void>;
  readonly reportSuccess: () => void;
}): Promise<void> {
  await options.installOverlay(options.manifest, options.enabled);
  options.reportSuccess();
}

export async function runRadar2dToggleTransition(options: {
  readonly enabled: boolean;
  readonly loadManifest: () => Promise<void>;
  readonly disableOverlay: () => Promise<void>;
  readonly syncEnabled: (enabled: boolean) => void;
  readonly onError: (error: unknown) => void;
}): Promise<void> {
  if (!options.enabled) {
    try {
      await options.disableOverlay();
      options.syncEnabled(false);
    } catch (error) {
      options.syncEnabled(true);
      options.onError(error);
    }
    return;
  }

  try {
    await options.loadManifest();
    options.syncEnabled(true);
  } catch (error) {
    options.onError(error);
    try {
      await options.disableOverlay();
    } catch (cleanupError) {
      options.onError(cleanupError);
    }
    options.syncEnabled(false);
  }
}
