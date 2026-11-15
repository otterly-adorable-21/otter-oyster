// Runs once when the server starts. The Discord role check needs a timer, and only the Node runtime has one we can use.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startDiscordSync } = await import('./lib/discord-sync');
    startDiscordSync();
  }
}
