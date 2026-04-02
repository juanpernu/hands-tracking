import type { Plugin } from '../types';
import { validateUrl } from './url-validation';

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
        const raw = params.url as string;
        if (!raw) return { success: false, feedback: 'No URL provided' };
        const result = validateUrl(raw);
        if (!result.valid) return { success: false, feedback: result.reason };
        window.location.href = result.url;
        return { success: true, feedback: `Navigating to ${result.url}` };
      },
    },
  ],
};
