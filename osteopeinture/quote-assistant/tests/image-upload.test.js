const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const {
  MAX_IMAGE_COUNT,
  UploadError,
  buildAnthropicImageParts,
  createBudgetedMemoryStorage,
  normalizeImage,
  normalizeImages,
  summarizeImageUpload,
} = require('../lib/image-upload');

function makeFile({ name, mimeType, buffer }) {
  return {
    originalname: name,
    fieldname: 'images',
    mimetype: mimeType,
    size: buffer.length,
    buffer,
  };
}

function createStream(chunks) {
  return Readable.from(chunks);
}

function handleStoredFile(storage, req, file) {
  return new Promise((resolve, reject) => {
    storage._handleFile(req, file, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
  });
}

test('empty upload is rejected before decoding', async () => {
  await assert.rejects(
    () => normalizeImage(makeFile({
      name: 'empty.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.alloc(0),
    })),
    (error) => error instanceof UploadError && error.message.includes('empty')
  );
});

test('unsupported upload type is rejected', async () => {
  await assert.rejects(
    () => normalizeImage(makeFile({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image'),
    })),
    (error) => error instanceof UploadError && error.message.includes('Unsupported image type')
  );
});

test('corrupt claimed image bytes are rejected as a client error', async () => {
  await assert.rejects(
    () => normalizeImage(makeFile({
      name: 'spoofed.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('not actually a jpeg'),
    })),
    (error) => error instanceof UploadError && error.status === 415
  );
});

test('helper output summarizes images and enforces count guard', async () => {
  const normalized = [{
    originalName: 'room.jpg',
    originalMimeType: 'image/jpeg',
    mediaType: 'image/jpeg',
    byteLength: 1024,
    width: 100,
    height: 100,
    buffer: Buffer.from('a'),
    base64: Buffer.from('a').toString('base64'),
  }];

  assert.equal(summarizeImageUpload(normalized), 'Attached 1 image (1 KB total). Files: room.jpg.');
  assert.deepEqual(buildAnthropicImageParts(normalized), [{
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/jpeg',
      data: normalized[0].base64,
    },
  }]);

  await assert.rejects(
    () => normalizeImages(Array.from({ length: MAX_IMAGE_COUNT + 1 }, (_, index) => makeFile({
      name: `image-${index}.jpg`,
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    }))),
    (error) => error instanceof UploadError && error.message.includes(String(MAX_IMAGE_COUNT))
  );
});

test('raw storage rejects a file that exceeds the per-file input budget', async () => {
  const storage = createBudgetedMemoryStorage({ maxFileBytes: 10, maxRequestBytes: 20 });
  const req = {};
  const file = {
    fieldname: 'images',
    originalname: 'oversize.jpg',
    mimetype: 'image/jpeg',
    encoding: '7bit',
    stream: createStream([Buffer.alloc(11, 1)]),
  };

  await assert.rejects(
    () => handleStoredFile(storage, req, file),
    (error) => error instanceof UploadError && error.status === 413 && error.message.includes('input limit')
  );
});

test('raw storage rejects once the cumulative request budget is exceeded', async () => {
  const storage = createBudgetedMemoryStorage({ maxFileBytes: 10, maxRequestBytes: 15 });
  const req = {};
  const first = {
    fieldname: 'images',
    originalname: 'first.jpg',
    mimetype: 'image/jpeg',
    encoding: '7bit',
    stream: createStream([Buffer.alloc(8, 1)]),
  };
  const second = {
    fieldname: 'images',
    originalname: 'second.jpg',
    mimetype: 'image/jpeg',
    encoding: '7bit',
    stream: createStream([Buffer.alloc(8, 2)]),
  };

  await handleStoredFile(storage, req, first);
  await assert.rejects(
    () => handleStoredFile(storage, req, second),
    (error) => error instanceof UploadError && error.status === 413 && error.message.includes('Raw upload request')
  );
});
