import type { Plugin } from '../types';
import { validateUrl } from './url-validation';

export const tabsPlugin: Plugin = {
  id: 'dom.tabs',
  name: 'Tabs',
  description: 'Open and close browser tabs',
  actions: [
    {
      id: 'open-tab',
      description: 'Open a new browser tab',
      params: [{ name: 'url', type: 'string' as const, required: false, description: 'URL to open (defaults to blank)' }],
      async execute(params) {
        const raw = (params.url as string) || '';
        if (raw) {
          const result = validateUrl(raw);
          if (!result.valid) return { success: false, feedback: result.reason };
          const win = window.open(result.url, '_blank', 'noopener,noreferrer');
          if (win) return { success: true, feedback: `Opened new tab: ${result.url}` };
        } else {
          const win = window.open('about:blank', '_blank', 'noopener,noreferrer');
          if (win) return { success: true, feedback: 'Opened new tab' };
        }
        return { success: false, feedback: 'Popup blocked — allow popups for this site' };
      },
    },
    {
      id: 'close-tab',
      description: 'Close the current browser tab',
      async execute() {
        window.close();
        return { success: true, feedback: 'Close requested (may be blocked if tab was not script-opened)' };
      },
    },
  ],
};
