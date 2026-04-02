import type { Plugin } from '../types';

export const speechPlugin: Plugin = {
  id: 'browser.speech',
  name: 'Speech',
  description: 'Text-to-speech using the Web Speech API',
  actions: [
    {
      id: 'speak-text',
      description: 'Speak text aloud using text-to-speech',
      params: [
        { name: 'text', type: 'string' as const, required: true, description: 'Text to speak' },
        { name: 'lang', type: 'string' as const, required: false, description: 'Language code (default: en-US)' },
      ],
      async execute(params) {
        const text = params.text as string;
        if (!text) return { success: false, feedback: 'No text provided' };
        if (!window.speechSynthesis) return { success: false, feedback: 'Speech synthesis not supported' };
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = (params.lang as string) || 'en-US';
        window.speechSynthesis.speak(utterance);
        return { success: true, feedback: `Speaking: "${text.slice(0, 30)}..."` };
      },
    },
  ],
};
