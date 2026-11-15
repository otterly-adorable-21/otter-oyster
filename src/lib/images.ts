import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir } from './db';

// Every upload is decoded and re-encoded as WebP. That checks it really is an image, drops
// location and camera data (EXIF), and caps the size. Post images get a "p-" name and are only
// served by the access-checked media route; everything else is "f-" and is public.

export type ImageKind = 'banner' | 'avatar' | 'logo' | 'divider' | 'post';
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(['png', 'jpeg', 'webp', 'gif']);
const SAFE_NAME = /^[pf]-[0-9a-f-]{36}\.webp$/;

export class ImageError extends Error {}

const uploadsDir = (): string => path.join(dataDir(), 'uploads');
export const isSafeName = (n: string): boolean => SAFE_NAME.test(n);
export const isPrivateName = (n: string): boolean => n.startsWith('p-');

export async function saveImage(buf: Buffer, kind: ImageKind): Promise<string> {
  if (buf.length === 0 || buf.length > MAX_UPLOAD_BYTES) throw new ImageError('That image is over 10 MB.');
  let img = sharp(buf, { limitInputPixels: 40_000_000, failOn: 'error' });
  let meta;
  try {
    meta = await img.metadata();
  } catch {
    throw new ImageError('That file is not a readable image.');
  }
  if (!meta.format || !ALLOWED.has(meta.format)) throw new ImageError('Use a PNG, JPG, WebP or GIF image.');
  img = img.rotate(); // honor camera orientation, then metadata is dropped on output
  if (kind === 'avatar') img = img.resize(600, 600, { fit: 'cover' });
  else if (kind === 'banner') img = img.resize(1600, 900, { fit: 'inside', withoutEnlargement: true });
  else if (kind === 'logo') img = img.resize(700, 400, { fit: 'inside', withoutEnlargement: true });
  else if (kind === 'divider') img = img.resize(700, 140, { fit: 'inside', withoutEnlargement: true });
  else img = img.resize(1600, 1600, { fit: 'inside', withoutEnlargement: true });
  let out: Buffer;
  try {
    out = await img.webp({ quality: 85 }).toBuffer();
  } catch {
    throw new ImageError('That image could not be processed.');
  }
  const name = `${kind === 'post' ? 'p' : 'f'}-${randomUUID()}.webp`;
  await fs.mkdir(uploadsDir(), { recursive: true });
  await fs.writeFile(path.join(uploadsDir(), name), out, { mode: 0o640 });
  return name;
}

export async function readImage(name: string): Promise<Buffer | null> {
  if (!isSafeName(name)) return null;
  try {
    return await fs.readFile(path.join(uploadsDir(), name));
  } catch {
    return null;
  }
}

export async function deleteImage(name: string | null | undefined): Promise<void> {
  if (!name || !isSafeName(name)) return;
  await fs.rm(path.join(uploadsDir(), name), { force: true });
}
