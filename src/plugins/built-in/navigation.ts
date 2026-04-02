import type { Plugin } from '../types';

export const navigationPlugin: Plugin = {
  id: 'dom.navigation',
  name: 'Navigation',
  description: 'Browser history navigation (back, forward, open URL)',
  actions: [
    {
      id: 'go-back',
      description: 'Navigate back in browser history',
      async execute() {
        window.history.back();
        return { success: true, feedback: 'Navigated back' };
      },
    },
    {
      id: 'go-forward',
      description: 'Navigate forward in browser history',
      async execute() {
        window.history.forward();
        return { success: true, feedback: 'Navigated forward' };
      },
    },
    {
      id: 'open-url',
      description: 'Open a URL in the current tab',
      params: [{ name: 'url', type: 'string' as const, required: true, description: 'The URL to navigate to' }],
      async execute(params) {
        const url = params.url as string;
        if (!url) return { success: false, feedback: 'No URL provided' };
        window.location.href = url;
        return { success: true, feedback: `Navigating to ${url}` };
      },
    },
  ],
};
