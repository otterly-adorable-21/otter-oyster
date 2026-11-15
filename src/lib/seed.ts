import { get, run, newId, nowIso } from './db';

/** Creates the demo creator once. Its art lives in public/example/ and is only used for this page. */
export function ensureExample(): void {
  if (get('SELECT 1 FROM creators WHERE isExample = 1')) return;
  const uid = newId(), cid = newId();
  const now = nowIso();
  run('INSERT INTO users (id, createdAt) VALUES (?,?)', uid, now);
  run(`INSERT INTO creators (id,userId,handle,name,bio,mainColor,accentColor,dividerKind,mascotOn,mascotLines,gankUrl,gankNick,gankVerified,verifyCode,tipUrl,hookSecret,isExample,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    cid, uid, 'otterlyadorable', 'Otterly Adorable',
    'An otter who paints ponds, lilies and very small adventures. This is a demo page: payment buttons go nowhere real.',
    '#00ffd5', '#ffffff', 'lily', 1, 'Thanks for stopping by!\nPond days are the best days.\nHave you seen my lilies?', 'https://example.com/', '', 0,
    'oo-demo', '', 'demo-' + newId(), 1, now);
  const tiers: [string, number, string[]][] = [
    ['Pebble', 3, ['Behind-the-scenes sketches', 'Name in the credits']],
    ['Lily Pad', 8, ['Everything in Pebble', 'Full-size pond art', 'Monthly wallpaper']],
    ['Deep Pond', 20, ['Everything in Lily Pad', 'Vote on the next piece', 'Early access']],
  ];
  const ids = tiers.map(([name, price, perks], i) => {
    const id = newId();
    run('INSERT INTO tiers (id, creatorId, position, name, price, perks, gankUrl) VALUES (?,?,?,?,?,?,?)', id, cid, i, name, price, JSON.stringify(perks), 'https://example.com/');
    return id;
  });
  const posts: [string, string, number | null][] = [
    ['Welcome to the pond', 'A quiet morning, a few ripples, and the first sketch of the season.', null],
    ['Lily pad studies', 'Three studies of light on water, with notes on the colors I mixed.', 0],
    ['The big otter piece', 'The full-size version, with process notes and the palette.', 1],
  ];
  posts.forEach(([title, body, t], i) =>
    run('INSERT INTO posts (id, creatorId, tierId, title, body, nsfw, createdAt) VALUES (?,?,?,?,?,?,?)',
      newId(), cid, t === null ? null : ids[t], title, body, 0, new Date(Date.now() - i * 86400_000).toISOString()));
}
