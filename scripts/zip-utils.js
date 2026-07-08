const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let value = i;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[i] = value >>> 0;
}

function createZipFromDirectory(sourceDir, zipPath) {
  const files = listFiles(sourceDir);
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;

  for (const file of files) {
    const relativePath = toZipPath(path.relative(sourceDir, file));
    const nameBuffer = Buffer.from(relativePath);
    const data = fs.readFileSync(file);
    const compressed = zlib.deflateRawSync(data);
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(ZIP_METHOD_DEFLATE, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    chunks.push(localHeader, nameBuffer, compressed);
    centralDirectory.push({
      nameBuffer,
      checksum,
      compressedLength: compressed.length,
      uncompressedLength: data.length,
      offset
    });
    offset += localHeader.length + nameBuffer.length + compressed.length;
  }

  const centralStart = offset;
  for (const entry of centralDirectory) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(ZIP_METHOD_DEFLATE, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0, 14);
    header.writeUInt32LE(entry.checksum, 16);
    header.writeUInt32LE(entry.compressedLength, 20);
    header.writeUInt32LE(entry.uncompressedLength, 24);
    header.writeUInt16LE(entry.nameBuffer.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(entry.offset, 42);
    chunks.push(header, entry.nameBuffer);
    offset += header.length + entry.nameBuffer.length;
  }

  const centralLength = offset - centralStart;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centralDirectory.length, 8);
  end.writeUInt16LE(centralDirectory.length, 10);
  end.writeUInt32LE(centralLength, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  chunks.push(end);

  fs.writeFileSync(zipPath, Buffer.concat(chunks));
}

function extractZip(zipPath, targetDir) {
  const buffer = fs.readFileSync(zipPath);
  let offset = 0;

  while (offset < buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) {
      throw new Error(`Unsupported ZIP structure near byte ${offset}.`);
    }

    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedLength = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedLength;

    if (flags & 0x0008) {
      throw new Error("ZIP entries with data descriptors are not supported.");
    }

    const fileName = buffer.slice(nameStart, nameEnd).toString("utf8");
    const safeName = sanitizeZipPath(fileName);
    if (safeName && !safeName.endsWith("/")) {
      const outputPath = path.join(targetDir, safeName);
      const compressed = buffer.slice(dataStart, dataEnd);
      let data;
      if (method === ZIP_METHOD_STORE) {
        data = compressed;
      } else if (method === ZIP_METHOD_DEFLATE) {
        data = zlib.inflateRawSync(compressed);
      } else {
        throw new Error(`Unsupported ZIP compression method ${method}.`);
      }
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, data);
    }

    offset = dataEnd;
  }
}

function listFiles(sourceDir) {
  const files = [];
  for (const item of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const absolutePath = path.join(sourceDir, item.name);
    if (item.name === ".DS_Store") continue;
    if (item.isDirectory()) {
      files.push(...listFiles(absolutePath));
    } else if (item.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function sanitizeZipPath(fileName) {
  const normalized = path.posix.normalize(String(fileName || "").replace(/\\/g, "/"));
  if (!normalized || normalized === "." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    return "";
  }
  return normalized;
}

function toZipPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

module.exports = {
  createZipFromDirectory,
  extractZip
};
