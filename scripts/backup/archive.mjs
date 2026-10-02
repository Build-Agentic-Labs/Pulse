import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'node:crypto';
import { createWriteStream, createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { once } from 'node:events';
import { createInterface } from 'node:readline';

const MAGIC = Buffer.from('PULSEBK1');
export function keyFor(password, salt) {
  if (typeof password !== 'string' || password.length < 16) throw new Error('Use a backup password of at least 16 characters.');
  return scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** Append-only, authenticated encrypted records. Plaintext never reaches disk. */
export async function writeArchive(destination, password, records) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(password, salt), iv);
  const partial = `${destination}.partial`;
  const output = createWriteStream(partial, { flags: 'wx', mode: 0o600 });
  let outputError, created = false;
  output.on('open', () => { created = true; });
  output.on('error', (error) => { outputError = error; });
  const write = async (bytes) => {
    if (outputError) throw outputError;
    if (!output.write(bytes)) await once(output, 'drain');
  };
  try {
    await write(Buffer.concat([MAGIC, salt, iv]));
    const hashes = createHash('sha256');
    let count = 0;
    for await (const record of records) {
      if (record.type === 'complete') throw new Error('Reserved record type.');
      const line = Buffer.from(`${JSON.stringify(record)}\n`);
      hashes.update(line); count++;
      await write(cipher.update(line));
    }
    await write(cipher.update(Buffer.from(`${JSON.stringify({ type: 'complete', records: count, sha256: hashes.digest('hex') })}\n`)));
    await write(cipher.final());
    await write(cipher.getAuthTag());
    output.end(); await once(output, 'close');
    if (outputError) throw outputError;
    const { open } = await import('node:fs/promises');
    const handle = await open(partial, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    // Destination names are unique job UUIDs; never replace an existing archive.
    const { link } = await import('node:fs/promises');
    await link(partial, destination);
    await unlink(partial);
  } catch (error) {
    output.destroy();
    if (created) await unlink(partial).catch(() => {});
    throw error;
  }
}
/** Offline verification only: never connects to a database or restores data.
 * @param {string} file
 * @param {string} password
 * @param {((record: object) => void | Promise<void>) | null} [onRecord]
 */
async function verifyArchiveInternal(file, password, onRecord = null, recordHashes = null) {
  const { open, stat } = await import('node:fs/promises');
  const size = (await stat(file)).size;
  if (size < 68) throw new Error('Incomplete backup.');
  const handle = await open(file, 'r');
  const header = Buffer.alloc(36), tag = Buffer.alloc(16);
  try { await handle.read(header, 0, 36, 0); await handle.read(tag, 0, 16, size - 16); }
  finally { await handle.close(); }
  if (!header.subarray(0, 8).equals(MAGIC)) throw new Error('Unsupported backup format.');
  const decipher = createDecipheriv('aes-256-gcm', keyFor(password, header.subarray(8, 24)), header.subarray(24, 36));
  decipher.setAuthTag(tag);
  const input = createReadStream(file, { start: 36, end: size - 17 });
  input.on('error', (error) => decipher.destroy(error));
  input.pipe(decipher);
  const hashes = createHash('sha256'); let count = 0, complete, activeFile;
  let files = 0;
  // Recovery callbacks only see fully authenticated records. Bounded memory;
  // full-sized production restore needs a separate staging design.
  const pending = []; let pendingBytes = 0;
  try {
    for await (const line of createInterface({ input: decipher, crlfDelay: Infinity })) {
      if (recordHashes) {
        if (recordHashes.length >= 250000) throw new Error('Recovery record index exceeds its 250000 record limit.');
        recordHashes.push(digest(line));
      }
      const record = JSON.parse(line);
      if (complete) throw new Error('Unexpected trailing records.');
      if (record.type === 'complete') complete = record;
      else {
        hashes.update(`${line}\n`); count++;
        if (record.type === 'file-start') {
          if (activeFile) throw new Error('Unfinished file.');
          activeFile = { bytes: 0, chunks: 0, hash: createHash('sha256') };
        } else if (record.type === 'file-chunk') {
          if (!activeFile || record.chunk !== activeFile.chunks) throw new Error('Invalid file chunk order.');
          const bytes = Buffer.from(record.data, 'base64');
          activeFile.bytes += bytes.length; activeFile.chunks++; activeFile.hash.update(bytes);
        } else if (record.type === 'file-end') {
          if (!activeFile || activeFile.bytes !== record.bytes || activeFile.chunks !== record.chunks || activeFile.hash.digest('hex') !== record.sha256) throw new Error('File integrity check failed.');
          activeFile = undefined; files++;
        }
        if (onRecord) {
          pendingBytes += Buffer.byteLength(line);
          if (pendingBytes > 64 * 1024 * 1024) throw new Error('Verified record reader exceeds its 64 MiB limit. Use a staged recovery reader.');
          pending.push(record);
        }
      }
    }
    if (activeFile || !complete || complete.records !== count || complete.sha256 !== hashes.digest('hex')) throw new Error('Backup integrity check failed.');
    if (onRecord) for (const record of pending) await onRecord(record);
    return { records: count, files, integrityVerified: true, restoreTested: false };
  } finally { input.destroy(); decipher.destroy(); }
}

/**
 * @param {string} file
 * @param {string} password
 * @param {((record: object) => void | Promise<void>) | null} [onRecord]
 */
export async function verifyArchive(file, password, onRecord = null) {
  return verifyArchiveInternal(file, password, onRecord);
}
/**
 * Scalable, two-pass authenticated recovery reader. First authenticate the entire
 * archive without exposing records. Then require every replayed plaintext record
 * to match its authenticated first-pass digest before yielding it. No plaintext
 * staging files. Recovery consumers must commit only after iteration finishes.
 * A concurrently changed/truncated archive fails replay; yielded records always
 * match the fully authenticated first pass, even before that failure is detected.
 */
export async function* verifiedRecords(file, password) {
  const hashes = [];
  await verifyArchiveInternal(file, password, null, hashes);
  const {open,stat} = await import('node:fs/promises');
  const size=(await stat(file)).size, handle=await open(file,'r');
  const header=Buffer.alloc(36),tag=Buffer.alloc(16);
  try{await handle.read(header,0,36,0);await handle.read(tag,0,16,size-16);}finally{await handle.close();}
  if(!header.subarray(0,8).equals(MAGIC))throw new Error('Archive changed before recovery.');
  const decipher=createDecipheriv('aes-256-gcm',keyFor(password,header.subarray(8,24)),header.subarray(24,36));decipher.setAuthTag(tag);
  const input=createReadStream(file,{start:36,end:size-17});input.on('error',error=>decipher.destroy(error));input.pipe(decipher);let index=0;
  try{
    for await(const line of createInterface({input:decipher,crlfDelay:Infinity})){
      if(index>=hashes.length || digest(line)!==hashes[index++])throw new Error('Archive changed during authenticated recovery.');
      const record=JSON.parse(line);if(record.type!=='complete')yield record;
    }
    if(index!==hashes.length)throw new Error('Archive truncated during recovery.');
  }finally{input.destroy();decipher.destroy();}
}
