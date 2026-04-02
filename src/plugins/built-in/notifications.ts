import type { Plugin } from '../types';

export const notificationsPlugin: Plugin = {
  id: 'browser.notifications',
  name: 'Notifications',
  description: 'Show browser notifications',
  actions: [
    {
      id: 'show-notification',
      description: 'Display a browser notification',
      params: [
        { name: 'title', type: 'string' as const, required: true, description: 'Notification title' },
        { name: 'body', type: 'string' as const, required: false, description: 'Notification body text' },
      ],
      async execute(params) {
        const title = params.title as string;
        if (!title) return { success: false, feedback: 'No title provided' };
        if (!('Notification' in window)) return { success: false, feedback: 'Notifications not supported' };
        if (Notification.permission === 'denied') return { success: false, feedback: 'Notifications permission denied' };
        if (Notification.permission !== 'granted') {
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') return { success: false, feedback: 'Notifications permission denied' };
        }
        new Notification(title, { body: (params.body as string) || '' });
        return { success: true, feedback: `Notification: ${title}` };
      },
    },
  ],
  async init() {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  },
};
