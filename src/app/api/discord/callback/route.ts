import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth';
import { get, run } from '@/lib/db';
import type { CreatorRow } from '@/lib/db';
import { exchangeCode, whoAmI, discord, discordConfigured } from '@/lib/discord';
import { consumeState, syncMember } from '@/lib/discord-sync';

export const dynamic = 'force-dynamic';
const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const go = (path: string) => NextResponse.redirect(appUrl() + path, 303);

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const st = q.get('state') ? consumeState(q.get('state')!) : null;
  const v = await getViewer();
  // The sign-in must be the same person who started it. Anything else is dropped.
  if (!st || !v || v.user.id !== st.userId || !discordConfigured()) return go('/discord?s=expired');
  const creator = get<CreatorRow>('SELECT * FROM creators WHERE id = ?', st.creatorId);
  if (!creator) return go('/discord?s=none');
  const code = q.get('code');
  if (q.get('error') || !code) return go(st.kind === 'install' ? '/studio?tab=discord&d=cancelled' : `/discord?s=cancelled&c=${creator.handle}`);

  try {
    const tok = await exchangeCode(code);

    if (st.kind === 'install') {
      if (v.user.id !== creator.userId || !tok.guild) return go('/studio?tab=discord&d=failed');
      const taken = get('SELECT 1 FROM creators WHERE discordGuildId = ? AND id != ?', tok.guild.id, creator.id);
      if (taken) return go('/studio?tab=discord&d=taken');
      await discord.roles(tok.guild.id); // proves the bot is really in that server
      // A new server means the old tier roles no longer apply.
      run("UPDATE tiers SET discordRoleId = '' WHERE creatorId = ?", creator.id);
      run('DELETE FROM discord_grants WHERE creatorId = ?', creator.id);
      run('UPDATE creators SET discordGuildId = ?, discordGuildName = ? WHERE id = ?', tok.guild.id, tok.guild.name.slice(0, 100), creator.id);
      return go('/studio?tab=discord&d=added');
    }

    // Fan: prove which Discord account this is, then give the role if they have paid.
    if (!creator.discordGuildId) return go('/discord?s=none');
    const me = await whoAmI(tok.accessToken);
    const other = get<{ userId: string }>('SELECT userId FROM discord_links WHERE discordUserId = ?', me.id);
    if (other && other.userId !== v.user.id) return go(`/discord?s=used&c=${creator.handle}`);
    run(`INSERT INTO discord_links (userId, discordUserId, username, createdAt) VALUES (?,?,?,?)
         ON CONFLICT (userId) DO UPDATE SET discordUserId = excluded.discordUserId, username = excluded.username`,
      v.user.id, me.id, me.username.slice(0, 100), new Date().toISOString());
    const r = await syncMember(creator, v.user.id, discord, { accessToken: tok.accessToken });
    const s = r === 'unchanged' || r === 'added' || r === 'swapped' ? 'ok' : 'nopay';
    return go(`/discord?s=${s}&c=${creator.handle}`);
  } catch (e) {
    console.error('discord callback failed', e instanceof Error ? e.message : e);
    return go(st.kind === 'install' ? '/studio?tab=discord&d=failed' : `/discord?s=error&c=${creator.handle}`);
  }
}
