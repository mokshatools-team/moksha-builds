const sharp = require('sharp');
const heicConvert = require('heic-convert');

const MAX_IMAGE_COUNT = 15;
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 900 * 1024;
const MAX_TOTAL_OUTPUT_BYTES = 9 * 1024 * 1024;
const MAX_RAW_TOTAL_BYTES = 75 * 1024 * 1024;
const MAX_DIMENSION = 1800;
const JPEG_QUALITY_STEPS = [82, 74, 66, 58, 50];

const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

class UploadError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
  }
}

const RAW_BUDGET_STATE = Symbol('rawBudgetState');

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0 KB';
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function convertHeicBuffer(buffer) {
  try {
    return await heicConvert({
      buffer,
      format: 'JPEG',
      quality: 1,
    });
  } catch (error) {
    throw new UploadError(`Unable to convert HEIC image: ${error.message}`);
  }
}

function ensureSupportedType(file) {
  const mimeType = file && file.mimetype;
  if (!mimeType || !SUPPORTED_MIME_TYPES.has(mimeType)) {
    throw new UploadError(`Unsupported image type: ${mimeType || 'unknown'}`);
  }
}

async function normalizeImage(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new UploadError('Invalid image upload');
  }

  if (file.buffer.length === 0 || file.size === 0) {
    throw new UploadError(`Image ${file.originalname || 'upload'} is empty`);
  }

  ensureSupportedType(file);

  if (file.size > MAX_INPUT_BYTES) {
    throw new UploadError(`Image ${file.originalname || 'upload'} exceeds the 20MB input limit`, 413);
  }

  try {
    let inputBuffer = file.buffer;
    if (file.mimetype === 'image/heic' || file.mimetype === 'image/heif') {
      inputBuffer = await convertHeicBuffer(file.buffer);
    }

    const pipeline = sharp(inputBuffer).rotate().resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    });

    let lastResult = null;
    for (const quality of JPEG_QUALITY_STEPS) {
      const result = await pipeline
        .clone()
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });

      lastResult = result;
      if (result.data.length <= MAX_OUTPUT_BYTES) {
        return {
          originalName: file.originalname || 'image',
          originalMimeType: file.mimetype,
          mediaType: 'image/jpeg',
          byteLength: result.data.length,
          width: result.info.width || null,
          height: result.info.height || null,
          buffer: result.data,
          base64: result.data.toString('base64'),
        };
      }
    }

    const sizeLabel = lastResult ? formatBytes(lastResult.data.length) : 'unknown size';
    throw new UploadError(
      `Image ${file.originalname || 'upload'} could not be compressed below ${formatBytes(MAX_OUTPUT_BYTES)} (last attempt: ${sizeLabel})`,
      413
    );
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError(
      `Unable to decode image ${file.originalname || 'upload'}: ${error.message}`,
      415
    );
  }
}

async function normalizeImages(files) {
  const uploads = Array.isArray(files) ? files : [];
  if (uploads.length > MAX_IMAGE_COUNT) {
    throw new UploadError(`A maximum of ${MAX_IMAGE_COUNT} images can be uploaded at once`, 400);
  }

  const normalized = [];
  let totalBytes = 0;

  for (const file of uploads) {
    const image = await normalizeImage(file);
    totalBytes += image.byteLength;
    if (totalBytes > MAX_TOTAL_OUTPUT_BYTES) {
      throw new UploadError(
        `Normalized images exceed the ${formatBytes(MAX_TOTAL_OUTPUT_BYTES)} request budget`,
        413
      );
    }
    normalized.push(image);
  }

  return normalized;
}

function createBudgetedMemoryStorage(options = {}) {
  const maxFileBytes = options.maxFileBytes || MAX_INPUT_BYTES;
  const maxRequestBytes = options.maxRequestBytes || MAX_RAW_TOTAL_BYTES;

  function getState(req) {
    if (!req[RAW_BUDGET_STATE]) {
      req[RAW_BUDGET_STATE] = { bytes: 0 };
    }
    return req[RAW_BUDGET_STATE];
  }

  return {
    _handleFile(req, file, cb) {
      const state = getState(req);
      const chunks = [];
      let fileBytes = 0;
      let settled = false;

      const cleanup = () => {
        file.stream.off('data', onData);
        file.stream.off('end', onEnd);
        file.stream.off('error', onError);
      };

      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (typeof file.stream.destroy === 'function') {
          file.stream.destroy();
        } else if (typeof file.stream.resume === 'function') {
          file.stream.resume();
        }
        cb(error);
      };

      const onData = (chunk) => {
        if (settled) return;
        fileBytes += chunk.length;
        state.bytes += chunk.length;

        if (fileBytes > maxFileBytes) {
          return fail(new UploadError(
            `Image ${file.originalname || 'upload'} exceeds the 20MB input limit`,
            413
          ));
        }

        if (state.bytes > maxRequestBytes) {
          return fail(new UploadError(
            `Raw upload request exceeds ${formatBytes(maxRequestBytes)} budget`,
            413
          ));
        }

        chunks.push(chunk);
      };

      const onEnd = () => {
        if (settled) return;
        settled = true;
        cleanup();
        cb(null, {
          buffer: Buffer.concat(chunks),
          size: fileBytes,
          fieldname: file.fieldname,
          originalname: file.originalname,
          encoding: file.encoding,
          mimetype: file.mimetype,
        });
      };

      const onError = (error) => {
        fail(new UploadError(`Unable to read upload stream: ${error.message}`, 400));
      };

      file.stream.on('data', onData);
      file.stream.on('end', onEnd);
      file.stream.on('error', onError);
    },
    _removeFile(req, file, cb) {
      cb(null);
    },
  };
}

function buildAnthropicImageParts(normalizedImages) {
  return (normalizedImages || []).map((image) => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: image.mediaType,
      data: image.base64,
    },
  }));
}

function summarizeImageUpload(normalizedImages) {
  const images = Array.isArray(normalizedImages) ? normalizedImages : [];
  if (!images.length) return '';

  const totalBytes = images.reduce((sum, image) => sum + (image.byteLength || 0), 0);
  const previewNames = images.slice(0, 3).map((image) => image.originalName).filter(Boolean);
  const preview = previewNames.join(', ');
  const remainder = images.length > previewNames.length ? `, +${images.length - previewNames.length} more` : '';

  return `Attached ${images.length} image${images.length === 1 ? '' : 's'} (${formatBytes(totalBytes)} total). Files: ${preview || 'unnamed'}${remainder}.`;
}

module.exports = {
  JPEG_QUALITY_STEPS,
  MAX_DIMENSION,
  MAX_IMAGE_COUNT,
  MAX_INPUT_BYTES,
  MAX_OUTPUT_BYTES,
  MAX_RAW_TOTAL_BYTES,
  MAX_TOTAL_OUTPUT_BYTES,
  SUPPORTED_MIME_TYPES,
  UploadError,
  buildAnthropicImageParts,
  createBudgetedMemoryStorage,
  normalizeImage,
  normalizeImages,
  summarizeImageUpload,
};
