import { ipcMain } from 'electron';

export function registerIPC(routes, context = {}) {
  for (const [channel, handler] of Object.entries(routes)) {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await handler(context, ...args);
      } catch (err) {
        return { success: false, error: err.message };
      }
    });
  }
}
