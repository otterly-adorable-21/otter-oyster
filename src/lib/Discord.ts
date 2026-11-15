// Talking to Discord. One shared bot ("Otter & Oyster") that every creator adds to their own server.
// Everything here is plain HTTPS calls, so the bot needs no always-on process of its own.
//
// Permissions the bot asks for: Manage Roles (268435456) and Create Instant Invite (1).
// Not Administrator: the bot never needs it, and a leaked bot token with Administrator would put every creator's server at risk.

const API = 'https://discord.com/api/v10';
export const BOT_PERMISSIONS = 268435457;

export class DiscordError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const env = (k: string): string => (process.env[k] || '').trim();
export const discordConfigured = (): boolean => !!(env('DISCORD_CLIENT_ID') && env('DISCORD_CLIENT_SECRET') && env('DISCORD_BOT_TOKEN'));
export const redirectUri = (): string => `${(process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')}/api/discord/callback`;

/** Creator adds the bot to a server. The code we get back tells us which server they picked. */
export function installUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: env('DISCORD_CLIENT_ID'), scope: 'bot', permissions: String(BOT_PERMISSIONS),
    response_type: 'code', redirect_uri: redirectUri(), state,
  });
  return `https://discord.com/oauth2/authorize?${q}`;
}
/** Fan proves which Discord account is theirs. guilds.join lets the bot add them to the server too. */
export function fanUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: env('DISCORD_CLIENT_ID'), scope: 'identify guilds.join', response_type: 'code',
    redirect_uri: redirectUri(), state, prompt: 'none',
  });
  return `https://discord.com/oauth2/authorize?${q}`;
}

type Auth = { bot: true } | { bearer: string } | { none: true };
async function call(method: string, path: string, opts: { auth: Auth; json?: unknown; form?: Record<string, string> } ): Promise<{ status: number; data: any }> {
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = {};
    if ('bot' in opts.auth) headers.authorization = `Bot ${env('DISCORD_BOT_TOKEN')}`;
    if ('bearer' in opts.auth) headers.authorization = `Bearer ${opts.auth.bearer}`;
    let body: string | undefined;
    if (opts.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.json); }
    if (opts.form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(opts.form).toString(); }
    const res = await fetch(API + path, { method, headers, body, signal: AbortSignal.timeout(15000) });
    if (res.status === 429 && attempt < 3) {
      const wait = Number((await res.json().catch(() => ({}))).retry_after) || 1;
      await new Promise((r) => setTimeout(r, Math.min(wait, 5) * 1000));
      continue;
    }
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { status: res.status, data };
  }
}
const ok = (r: { status: number; data: any }, what: string) => {
  if (r.status >= 200 && r.status < 300) return r.data;
  throw new DiscordError(r.status, `${what} failed (${r.status}${r.data?.message ? `: ${r.data.message}` : ''})`);
};

export interface DiscordRole { id: string; name: string; position: number; managed: boolean }

/** What the rest of the site needs from Discord. A fake of this is used in tests. */
export interface DiscordClient {
  addRole(guildId: string, userId: string, roleId: string): Promise<void>;
  removeRole(guildId: string, userId: string, roleId: string): Promise<void>;
  addMemberWithRole(guildId: string, userId: string, accessToken: string, roleId: string): Promise<void>;
  roles(guildId: string): Promise<DiscordRole[]>;
  manageableRoles(guildId: string): Promise<DiscordRole[]>;
  createRole(guildId: string, name: string): Promise<DiscordRole>;
  leaveGuild(guildId: string): Promise<void>;
}

let botId = '';
async function botUserId(): Promise<string> {
  if (!botId) botId = ok(await call('GET', '/users/@me', { auth: { bot: true } }), 'Reading the bot').id;
  return botId;
}

export const discord: DiscordClient = {
  async addRole(g, u, r) { ok(await call('PUT', `/guilds/${g}/members/${u}/roles/${r}`, { auth: { bot: true } }), 'Giving the role'); },
  async removeRole(g, u, r) { ok(await call('DELETE', `/guilds/${g}/members/${u}/roles/${r}`, { auth: { bot: true } }), 'Removing the role'); },
  async addMemberWithRole(g, u, token, r) {
    // 201 = added, 204 = was already in the server (the role is then given separately).
    const res = await call('PUT', `/guilds/${g}/members/${u}`, { auth: { bot: true }, json: { access_token: token, roles: [r] } });
    ok(res, 'Adding the member');
    if (res.status === 204) await discord.addRole(g, u, r);
  },
  async roles(g) {
    const list = ok(await call('GET', `/guilds/${g}/roles`, { auth: { bot: true } }), 'Reading roles') as DiscordRole[];
    return list.map((x) => ({ id: x.id, name: x.name, position: x.position, managed: !!x.managed }));
  },
  async manageableRoles(g) {
    const all = await discord.roles(g);
    const me = ok(await call('GET', `/guilds/${g}/members/${await botUserId()}`, { auth: { bot: true } }), 'Reading the bot in your server') as { roles: string[] };
    const top = Math.max(0, ...all.filter((r) => me.roles.includes(r.id)).map((r) => r.position));
    // @everyone has the same id as the server. Managed roles belong to other bots. The bot can only touch roles below its own.
    return all.filter((r) => r.id !== g && !r.managed && r.position < top).sort((a, b) => b.position - a.position);
  },
  async createRole(g, name) {
    const r = ok(await call('POST', `/guilds/${g}/roles`, { auth: { bot: true }, json: { name: name.slice(0, 100), permissions: '0', mentionable: false } }), 'Creating the role');
    return { id: r.id, name: r.name, position: r.position, managed: false };
  },
  async leaveGuild(g) { ok(await call('DELETE', `/users/@me/guilds/${g}`, { auth: { bot: true } }), 'Leaving the server'); },
};

export interface CodeResult { accessToken: string; guild?: { id: string; name: string } }
export async function exchangeCode(code: string): Promise<CodeResult> {
  const r = await call('POST', '/oauth2/token', { auth: { none: true }, form: {
    client_id: env('DISCORD_CLIENT_ID'), client_secret: env('DISCORD_CLIENT_SECRET'),
    grant_type: 'authorization_code', code, redirect_uri: redirectUri(),
  } });
  const d = ok(r, 'Discord sign-in');
  return { accessToken: String(d.access_token), guild: d.guild ? { id: String(d.guild.id), name: String(d.guild.name || '') } : undefined };
}
export async function whoAmI(accessToken: string): Promise<{ id: string; username: string }> {
  const d = ok(await call('GET', '/users/@me', { auth: { bearer: accessToken } }), 'Reading your Discord name');
  return { id: String(d.id), username: String(d.global_name || d.username || '') };
}
