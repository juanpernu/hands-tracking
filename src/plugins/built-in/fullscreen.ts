import type { Plugin } from '../types';

export const fullscreenPlugin: Plugin = {
  id: 'browser.fullscreen',
  name: 'Fullscreen',
  description: 'Toggle browser fullscreen mode',
  actions: [
    {
      id: 'toggle',
      description: 'Toggle fullscreen on or off',
      async execute() {
        try {
          if (document.fullscreenElement) {
            await document.exitFullscreen();
            return { success: true, feedback: 'Exited fullscreen' };
          } else {
            await document.documentElement.requestFullscreen();
            return { success: true, feedback: 'Entered fullscreen' };
          }
        } catch (err) {
          return { success: false, feedback: `Fullscreen failed: ${(err as Error).message}` };
        }
      },
    },
  ],
};
