// ZIP files in the browser, for the web app's exports and imports, where the
// desktop app's Go services make and read them: deflated with the
// browser's own CompressionStream, so it needs no library. Only what
// exports make and imports meet: no encryption, no ZIP64, one disk.

export interface ZipEntry {
  /** Relative, separated by slashes. */
  readonly path: string;
  readonly data: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** The CRC-32 a ZIP file keeps of each file's bytes. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function through(
  data: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const piped = new Blob([data.slice()]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

/** A date as MS-DOS keeps it, which ZIP files do: its time, then its day. */
function dosTime(date: Date): [number, number] {
  const year = Math.max(date.getFullYear(), 1980);
  return [
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  ];
}

/** A ZIP file of the entries, each deflated where that makes it smaller. */
export async function makeZip(entries: readonly ZipEntry[], now = new Date()): Promise<Blob> {
  const [time, day] = dosTime(now);
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.data);
    const deflated = await through(entry.data, new CompressionStream("deflate-raw"));
    const [method, body] = deflated.length < entry.data.length ? [8, deflated] : [0, entry.data];
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed: 2.0
    local.setUint16(6, 0x0800, true); // names in UTF-8
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, body.slice());

    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true); // made by: 2.0
    record.setUint16(6, 20, true);
    record.setUint16(8, 0x0800, true);
    record.setUint16(10, method, true);
    record.setUint16(12, time, true);
    record.setUint16(14, day, true);
    record.setUint32(16, crc, true);
    record.setUint32(20, body.length, true);
    record.setUint32(24, entry.data.length, true);
    record.setUint16(28, name.length, true);
    record.setUint32(42, offset, true);
    central.push(new Uint8Array(record.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {
    type: "application/zip",
  });
}

/** A file in a ZIP file, read when asked. */
export interface ZipFile {
  readonly path: string;
  readonly size: number;
  bytes(): Promise<Uint8Array>;
}

/** The files of a ZIP file, folders left out; it throws for what it cannot read. */
export function readZip(zip: Uint8Array): ZipFile[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // The end record is in the last 22 bytes and a comment of up to 64 KiB.
  let end = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end === -1) throw new Error("This is not a ZIP file.");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files: ZipFile[] = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > zip.length || view.getUint32(at, true) !== 0x02014b50) {
      throw new Error("This ZIP file is damaged.");
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    // Names not marked UTF-8 are read as it all the same, as most tools write it.
    const path = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength)).replace(/\\/g, "/");
    at += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith("/")) continue;
    if (flags & 1) throw new Error(`${path} is encrypted in the ZIP file.`);
    if (method !== 0 && method !== 8)
      throw new Error(`${path} is compressed in a way Nether cannot read.`);
    files.push({
      path,
      size,
      async bytes() {
        if (view.getUint32(local, true) !== 0x04034b50)
          throw new Error("This ZIP file is damaged.");
        const start =
          local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        const body = zip.subarray(start, start + packed);
        const data =
          method === 8 ? await through(body, new DecompressionStream("deflate-raw")) : body.slice();
        if (data.length !== size || crc32(data) !== crc)
          throw new Error(`${path} is damaged in the ZIP file.`);
        return data;
      },
    });
  }
  return files;
}
