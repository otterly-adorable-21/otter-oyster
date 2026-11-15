import { randomBytes } from 'node:crypto';
import { all, get, run, tx, newId, nowIso, type CreatorRow, type PostRow, type TierRow } from './db';
import { clamp, httpsUrl, intInRange, MAX_TIERS, nickFromUrl, parsePerks, validHandle, validHex } from './validate';

export const getCreatorByHandle = (handle: string): CreatorRow | undefined =>
  get<CreatorRow>('SELECT * FROM creators WHERE handle = ?', handle.toLowerCase());
export const getCreatorByUser = (userId: string): CreatorRow | undefined =>
  get<CreatorRow>('SELECT * FROM creators WHERE userId = ?', userId);
export const tiersOf = (creatorId: string): TierRow[] =>
  all<TierRow>('SELECT * FROM tiers WHERE creatorId = ? ORDER BY position', creatorId);
export const postsOf = (creatorId: string): PostRow[] =>
  all<PostRow>('SELECT * FROM posts WHERE creatorId = ? ORDER BY createdAt DESC', creatorId);

const token = (n: number): string => randomBytes(n).toString('hex');

export function createCreator(userId: string, handleRaw: string, nameRaw: string): { ok: true; creator: CreatorRow } | { ok: false; error: string } {
  const handle = validHandle(handleRaw);
  if (!handle) return { ok: false, error: 'Pick a handle of 3–30 letters, numbers, dashes or underscores that is not a reserved word.' };
  if (getCreatorByUser(userId)) return { ok: false, error: 'You already have a page.' };
  if (getCreatorByHandle(handle)) return { ok: false, error: 'That handle is taken.' };
  const id = newId();
  run(`INSERT INTO creators (id, userId, handle, name, verifyCode, hookSecret, createdAt) VALUES (?,?,?,?,?,?,?)`,
    id, userId, handle, clamp(nameRaw, 60) || 'Your Name', 'oo-' + token(4), token(24), nowIso());
  return { ok: true, creator: getCreatorByHandle(handle)! };
}

export interface ProfileInput {
  name?: string; bio?: string; mainColor?: string; accentColor?: string; bannerGrad?: string;
  avatarShape?: string; dividerKind?: string; mascotOn?: boolean; mascotLines?: string;
}
const SHAPES = new Set(['circle', 'rounded', 'square']);
const GRADS = new Set(['match', 'tide', 'dusk', 'meadow']);
const DIVS = new Set(['line', 'wave', 'dots', 'stars', 'none', 'upload']);

export function updateProfile(c: CreatorRow, p: ProfileInput): void {
  run(`UPDATE creators SET name = ?, bio = ?, mainColor = ?, accentColor = ?, bannerGrad = ?, avatarShape = ?, dividerKind = ?, mascotOn = ?, mascotLines = ? WHERE id = ?`,
    clamp(p.name, 60) || c.name, clamp(p.bio, 1200),
    validHex(p.mainColor) ?? c.mainColor, validHex(p.accentColor) ?? c.accentColor,
    GRADS.has(p.bannerGrad ?? '') ? p.bannerGrad! : c.bannerGrad,
    SHAPES.has(p.avatarShape ?? '') ? p.avatarShape! : c.avatarShape,
    DIVS.has(p.dividerKind ?? '') ? p.dividerKind! : c.dividerKind,
    p.mascotOn ? 1 : 0, clamp(p.mascotLines, 600) || c.mascotLines, c.id);
}

export function setImageField(creatorId: string, field: 'bannerFile' | 'avatarFile' | 'logoFile' | 'dividerFile', name: string | null): string | null {
  const prev = get<Record<string, string | null>>(`SELECT ${field} AS v FROM creators WHERE id = ?`, creatorId)?.v ?? null;
  run(`UPDATE creators SET ${field} = ? WHERE id = ?`, name, creatorId);
  return prev;
}

export interface TierInput { id?: string; name: string; price: unknown; perks: unknown; gankUrl?: string }

/** Replaces the tier list with up to 3 tiers. Existing tiers keep their id (and Gank reference) so access is not lost. */
export function saveTiers(creatorId: string, input: TierInput[]): { ok: true } | { ok: false; error: string } {
  if (input.length > MAX_TIERS) return { ok: false, error: `You can have at most ${MAX_TIERS} tiers.` };
  return tx(() => {
    const existing = tiersOf(creatorId);
    const keep = new Set(input.map((t) => t.id).filter(Boolean));
    for (const t of existing) {
      if (keep.has(t.id)) continue;
      const used = get<{ n: number }>('SELECT COUNT(*) n FROM posts WHERE tierId = ?', t.id)!.n;
      if (used) return { ok: false as const, error: `"${t.name}" still has posts. Move or delete those posts first.` };
      run('DELETE FROM tiers WHERE id = ?', t.id);
    }
    input.forEach((t, i) => {
      const price = intInRange(t.price, 1, 10000);
      const name = clamp(t.name, 40);
      if (!name || price === null) throw new Error('Each tier needs a name and a whole-dollar price.');
      const perks = JSON.stringify(parsePerks(t.perks));
      const url = t.gankUrl ? (httpsUrl(t.gankUrl) ?? '') : '';
      const owned = t.id && existing.find((e) => e.id === t.id);
      if (owned) run('UPDATE tiers SET position = ?, name = ?, price = ?, perks = ?, gankUrl = ? WHERE id = ?', i, name, price, perks, url, owned.id);
      else run('INSERT INTO tiers (id, creatorId, position, name, price, perks, gankUrl) VALUES (?,?,?,?,?,?,?)', newId(), creatorId, i, name, price, perks, url);
    });
    return { ok: true as const };
  });
}

export interface PostInput { id?: string; title: string; body: string; nsfw: boolean; tierId: string | null; imageAlt?: string }

export function savePost(creatorId: string, p: PostInput, imageFile?: string | null): { ok: true; id: string; prevImage: string | null } | { ok: false; error: string } {
  const title = clamp(p.title, 120);
  if (!title) return { ok: false, error: 'Give the post a title.' };
  if (p.tierId && !get('SELECT 1 FROM tiers WHERE id = ? AND creatorId = ?', p.tierId, creatorId)) return { ok: false, error: 'That tier does not exist.' };
  const body = clamp(p.body, 20000), alt = clamp(p.imageAlt, 200);
  if (p.id) {
    const cur = get<PostRow>('SELECT * FROM posts WHERE id = ? AND creatorId = ?', p.id, creatorId);
    if (!cur) return { ok: false, error: 'Post not found.' };
    run('UPDATE posts SET title = ?, body = ?, nsfw = ?, tierId = ?, imageAlt = ?, imageFile = ? WHERE id = ?',
      title, body, p.nsfw ? 1 : 0, p.tierId, alt, imageFile === undefined ? cur.imageFile : imageFile, cur.id);
    return { ok: true, id: cur.id, prevImage: imageFile !== undefined && imageFile !== cur.imageFile ? cur.imageFile : null };
  }
  const id = newId();
  run('INSERT INTO posts (id, creatorId, tierId, title, body, nsfw, imageFile, imageAlt, createdAt) VALUES (?,?,?,?,?,?,?,?,?)',
    id, creatorId, p.tierId, title, body, p.nsfw ? 1 : 0, imageFile ?? null, alt, nowIso());
  return { ok: true, id, prevImage: null };
}

export function deletePost(creatorId: string, id: string): string | null {
  const cur = get<PostRow>('SELECT * FROM posts WHERE id = ? AND creatorId = ?', id, creatorId);
  if (!cur) return null;
  run('DELETE FROM posts WHERE id = ?', id);
  return cur.imageFile;
}

/** Saves the pasted Gank link. Changing it resets verification, so nobody can keep a verified badge for a page they swapped away from. */
export function setGankLink(c: CreatorRow, urlRaw: string, tipRaw: string): { ok: true } | { ok: false; error: string } {
  const url = urlRaw.trim() ? httpsUrl(urlRaw) : '';
  const tip = tipRaw.trim() ? httpsUrl(tipRaw) : '';
  if (url === null) return { ok: false, error: 'That does not look like a web link (it should start with https://).' };
  if (tip === null) return { ok: false, error: 'The tip link is not a valid https:// link.' };
  const nick = url ? nickFromUrl(url) : '';
  const changed = url !== c.gankUrl;
  run('UPDATE creators SET gankUrl = ?, gankNick = ?, tipUrl = ?, gankVerified = CASE WHEN ? THEN 0 ELSE gankVerified END WHERE id = ?',
    url, nick, tip, changed ? 1 : 0, c.id);
  return { ok: true };
}

/** Marks a Gank page verified, unless some other creator already holds that name verified. */
export function markVerified(c: CreatorRow): { ok: true } | { ok: false; error: string } {
  const other = get('SELECT 1 FROM creators WHERE gankNick = ? AND gankVerified = 1 AND id != ?', c.gankNick, c.id);
  if (other) return { ok: false, error: 'That Gank page is already connected to another account.' };
  run('UPDATE creators SET gankVerified = 1 WHERE id = ?', c.id);
  return { ok: true };
}

export const unmatchedPrices = (creatorId: string): { priceRef: string; n: number; last: string }[] =>
  all(`SELECT priceRef, COUNT(*) n, MAX(receivedAt) last FROM webhook_events
       WHERE creatorId = ? AND status = 'unmatched' AND priceRef IS NOT NULL GROUP BY priceRef`, creatorId);

/** Deletes a creator's whole account: page, tiers, posts, payments records, login emails and sessions. Returns image files to remove from disk. */
export function deleteAccount(userId: string): string[] {
  return tx(() => {
    const c = getCreatorByUser(userId);
    const files: string[] = [];
    if (c) {
      if (c.isExample) return files;
      for (const f of [c.bannerFile, c.avatarFile, c.logoFile, c.dividerFile]) if (f) files.push(f);
      for (const p of postsOf(c.id)) if (p.imageFile) files.push(p.imageFile);
      // Posts first: a tier that still has posts is protected from deletion on purpose.
      run('DELETE FROM posts WHERE creatorId = ?', c.id);
      run('DELETE FROM creators WHERE id = ?', c.id);
    }
    run('DELETE FROM users WHERE id = ?', userId);
    return files;
  });
}
