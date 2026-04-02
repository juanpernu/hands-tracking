import type { Plugin } from '../types';

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
        const url = (params.url as string) || 'about:blank';
        const win = window.open(url, '_blank');
        if (win) return { success: true, feedback: `Opened new tab: ${url}` };
        return { success: false, feedback: 'Popup blocked — allow popups for this site' };
      },
    },
    {
      id: 'close-tab',
      description: 'Close the current browser tab',
      async execute() {
        window.close();
        return { success: true, feedback: 'Closing tab' };
      },
    },
  ],
};
