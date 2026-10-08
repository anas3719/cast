export const PROJECT = 'vmnkdbceyqudcxddvljx';
export const ORIGIN = 'https://anas3719.github.io';
export const BUCKET = 'cast-registration-private';
export const MAX_BYTES = 2147483648;
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const TICKET = /^[a-f0-9]{64}$/;

export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map(x => x.toString(16).padStart(2, '0')).join('');
}

export function matchesMedia(bytes, mime, fileSize = bytes.length) {
  const ascii = (offset, length) => String.fromCharCode(...bytes.slice(offset, offset + length));
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/png') return bytes.slice(0, 8).join() === '137,80,78,71,13,10,26,10';
  if (mime === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
  if (mime === 'video/webm') return bytes.slice(0, 4).join() === '26,69,223,163';
  if (['image/heic', 'image/heif', 'video/quicktime', 'video/mp4'].includes(mime)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Inspect bounded ISO/QuickTime atoms, including compatible (not only major) brands.
    for (let offset = 0; offset + 8 <= bytes.length;) {
      const size = view.getUint32(offset), type = ascii(offset + 4, 4);
      if (size < 8 || size > fileSize - offset) return false;
      if (type === 'ftyp') {
        if (size < 16 || offset + 16 > bytes.length) return false;
        const brands = [ascii(offset + 8, 4)];
        for (let position = offset + 16; position + 4 <= Math.min(offset + size, bytes.length); position += 4) {
          brands.push(ascii(position, 4));
        }
        return brands.some(brand => mime.startsWith('image/')
          ? /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)
          : /^(qt  |isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash)$/.test(brand));
      }
      if (!['free', 'skip', 'wide'].includes(type) || offset + size > bytes.length) return false;
      offset += size;
    }
  }
  return false;
}

export function validatedManifest(files, rules, mode) {
  if (!Array.isArray(files) || files.length > 11) throw new Error('Invalid files');
  const manifest = files.map((file, slot) => ({ name: String(file?.name || '').trim(),
    type: file?.type, size: file?.size, role: slot === 0 ? 'portrait' : 'work' }));
  if (manifest.some(x => !x.name || x.name.length > 255 || /[\u0000-\u001f]/.test(x.name))) throw new Error('Invalid filename');
  if (!rules.validateAttachments(manifest, mode, { imageBytes: MAX_BYTES, videoBytes: MAX_BYTES }).valid) {
    throw new Error('Invalid files');
  }
  return manifest;
}

export function privateView(record, files = []) {
  return { id: record.id, profileId: record.profile_id, createdAt: record.created_at,
    status: record.status, revision: record.revision,
    profile: { name: record.name, gender: record.gender, age: record.age, height: record.height,
      weight: record.weight, nationality: record.nationality, speaking: record.speaking ? 'yes' : 'no', category: record.category },
    privateContact: { whatsapp: record.whatsapp }, ownerNote: record.owner_note,
    works: { mode: record.works_mode, folderUrl: record.supplied_folder_url || '',
      reviewedCount: record.drive_reviewed_count, accessible: record.drive_access_verified },
    attachments: files.map(f => ({ id: f.id, role: f.role, name: f.original_name,
      type: f.mime_type, size: Number(f.declared_size), verified: Boolean(f.verified_at), url: f.url })),
  };
}
