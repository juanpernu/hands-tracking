import type { Plugin } from '../types';

export const clipboardPlugin: Plugin = {
  id: 'browser.clipboard',
  name: 'Clipboard',
  description: 'Copy and paste text using the clipboard API',
  actions: [
    {
      id: 'copy-selection',
      description: 'Copy the current text selection to clipboard',
      async execute() {
        const selection = window.getSelection()?.toString() || '';
        if (!selection) return { success: false, feedback: 'No text selected' };
        try {
          await navigator.clipboard.writeText(selection);
          return { success: true, feedback: 'Text copied to clipboard', data: selection };
        } catch {
          return { success: false, feedback: 'Clipboard access denied' };
        }
      },
    },
    {
      id: 'paste',
      description: 'Read text from clipboard',
      async execute() {
        try {
          const text = await navigator.clipboard.readText();
          return { success: true, feedback: 'Clipboard text read', data: text };
        } catch {
          return { success: false, feedback: 'Clipboard access denied' };
        }
      },
    },
  ],
};
