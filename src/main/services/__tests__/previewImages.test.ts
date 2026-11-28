import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IMAGE_MAX_BYTES, readPreviewImages, sniffImageType } from '../previewImages';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex');
const avif = (brands: string) => {
  const body = Buffer.from(`ftyp${brands}`, 'latin1');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length + 4);
  return Buffer.concat([size, body]);
};

describe('sniffImageType', () => {
  it('knows each type by its first bytes', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('GIF89a....'))).toBe('image/gif');
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(avif('avif\0\0\0\0mif1'))).toBe('image/avif');
    expect(sniffImageType(avif('mif1\0\0\0\0miafavis'))).toBe('image/avif');
    expect(sniffImageType(avif('isom\0\0\0\0mp41'))).toBeNull(); // an mp4
    expect(sniffImageType(Buffer.from('﻿<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="x">'))).toBe(
      'image/svg+xml',
    );
    expect(sniffImageType(Buffer.from('<html><svg>'))).toBeNull();
    expect(sniffImageType(Buffer.from('#!/bin/sh'))).toBeNull();
  });
});

describe('readPreviewImages', () => {
  let tmp: string;
  let cwd: string;
  let outside: string;
  let elsewhere: string;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-images-')));
    cwd = path.join(tmp, 'worktree');
    outside = path.join(tmp, 'memory');
    elsewhere = path.join(tmp, 'elsewhere');
    for (const d of [cwd, path.join(cwd, 'docs'), outside, elsewhere]) fs.mkdirSync(d);
    fs.writeFileSync(path.join(cwd, 'docs/shot.png'), PNG);
    fs.writeFileSync(path.join(cwd, 'my pic.jpg'), JPEG);
    fs.writeFileSync(path.join(outside, 'note.png'), PNG);
    fs.writeFileSync(path.join(elsewhere, 'secret.png'), PNG);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const read = (paths: string[]) => readPreviewImages(cwd, paths, [outside]);

  it('inlines images in the worktree and in an outside folder', async () => {
    const [a, b, c] = await read(['docs/shot.png', 'my pic.jpg', path.join(outside, 'note.png')]);
    expect(a).toEqual({ dataUri: `data:image/png;base64,${PNG.toString('base64')}` });
    expect(b).toEqual({ dataUri: `data:image/jpeg;base64,${JPEG.toString('base64')}` });
    expect(c).toHaveProperty('dataUri');
  });

  it('refuses a .. or an absolute path out of the roots', async () => {
    expect(
      await read([
        '../elsewhere/secret.png',
        path.join(elsewhere, 'secret.png'),
        `${outside}/../elsewhere/secret.png`,
      ]),
    ).toEqual([{ refused: 'outside' }, { refused: 'outside' }, { refused: 'outside' }]);
  });

  it('refuses a symlink that leads out, in the worktree too', async () => {
    fs.symlinkSync(path.join(elsewhere, 'secret.png'), path.join(cwd, 'link.png'));
    fs.symlinkSync(elsewhere, path.join(cwd, 'dir'));
    fs.symlinkSync(path.join(cwd, 'docs/shot.png'), path.join(cwd, 'inside.png'));
    expect(await read(['link.png', 'dir/secret.png', 'inside.png'])).toEqual([
      { refused: 'outside' },
      { refused: 'outside' },
      { dataUri: expect.stringMatching(/^data:image\/png;base64,/) },
    ]);
  });

  it('refuses a file that is not an image by its name or by its bytes', async () => {
    fs.writeFileSync(path.join(cwd, 'notes.txt'), 'hi');
    fs.writeFileSync(path.join(cwd, 'fake.png'), '<svg onload="alert(1)">');
    fs.writeFileSync(path.join(cwd, 'page.svg'), '<html><script>alert(1)</script>');
    fs.writeFileSync(path.join(cwd, 'jpeg.png'), JPEG);
    expect(await read(['notes.txt', 'fake.png', 'page.svg', 'jpeg.png'])).toEqual([
      { refused: 'type' },
      { refused: 'type' },
      { refused: 'type' },
      { refused: 'type' },
    ]);
  });

  it('refuses an image over the cap, and stops at the document cap', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(IMAGE_MAX_BYTES)]);
    fs.writeFileSync(path.join(cwd, 'big.png'), big);
    const near = Buffer.concat([PNG, Buffer.alloc(IMAGE_MAX_BYTES - PNG.length)]);
    for (const n of [1, 2, 3, 4, 5]) fs.writeFileSync(path.join(cwd, `${n}.png`), near);
    const out = await read(['big.png', '1.png', '2.png', '3.png', '4.png', '5.png']);
    expect(out[0]).toEqual({ refused: 'size' });
    expect(out.slice(1, 5).every((r) => 'dataUri' in r)).toBe(true);
    expect(out[5]).toEqual({ refused: 'size' });
  });

  it('says a missing file or a folder is missing', async () => {
    fs.mkdirSync(path.join(cwd, 'folder.png'));
    expect(await read(['gone.png', 'folder.png'])).toEqual([
      { refused: 'missing' },
      { refused: 'missing' },
    ]);
  });
});
