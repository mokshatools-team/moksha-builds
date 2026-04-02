const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'osteopeinture-route-test-'));
process.env.DATA_DIR = DATA_DIR;
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';

const {
  buildEmailDraft,
  createSessionHandler,
  getSession,
  handleSessionMessage,
  sendUploadError,
  setAnthropicClient,
} = require('../server');

test.after(() => {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test.beforeEach(() => {
  setAnthropicClient({
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: 'acknowledged' }],
      }),
    },
  });
});

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function createSession() {
  const res = makeRes();
  await createSessionHandler({}, res);
  return res.body.id;
}

test('message endpoint rejects empty multipart payloads', async () => {
  const id = await createSession();
  const res = makeRes();
  await handleSessionMessage({ params: { id }, body: {}, files: [] }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'No message or image');
});

test('message endpoint maps unexpected file fields distinctly', async () => {
  const res = makeRes();
  const handled = sendUploadError(res, { name: 'MulterError', code: 'LIMIT_UNEXPECTED_FILE' });
  assert.equal(handled.statusCode, 400);
  assert.equal(handled.body.error, 'Unexpected upload field');
});

test('message endpoint maps file size errors distinctly', async () => {
  const res = makeRes();
  const handled = sendUploadError(res, { name: 'MulterError', code: 'LIMIT_FILE_SIZE' });
  assert.equal(handled.statusCode, 413);
  assert.equal(handled.body.error, 'Each image must be 20MB or smaller');
});

test('message endpoint stores compact user content after a successful image upload', async () => {
  const id = await createSession();
  const imageBuffer = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  }).jpeg().toBuffer();

  const res = makeRes();
  await handleSessionMessage({
    params: { id },
    body: { message: 'Need help with this wall' },
    files: [{
      originalname: 'wall.jpg',
      mimetype: 'image/jpeg',
      size: imageBuffer.length,
      buffer: imageBuffer,
    }],
  }, res);

  assert.equal(res.statusCode, 200);
  const session = getSession(id);
  assert.equal(session.messages.length, 2);
  assert.equal(typeof session.messages[0].content, 'string');
  assert.match(session.messages[0].content, /Need help with this wall/);
  assert.match(session.messages[0].content, /Attached 1 image/);
  assert.equal(session.messages[1].role, 'assistant');
  assert.equal(typeof session.messages[1].content, 'string');
});

test('message endpoint accepts wrapped JSON responses when extracting quote data', async () => {
  const id = await createSession();
  setAnthropicClient({
    messages: {
      create: async () => ({
        content: [{
          type: 'text',
          text: `Quick check:\n\n{"clientName":"Test Client","projectId":"CLIENT_01","address":"123 Test St","sections":[]}\n\nLooks good.`,
        }],
      }),
    },
  });

  const res = makeRes();
  await handleSessionMessage({
    params: { id },
    body: { message: 'Build the quote' },
    files: [],
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.hasQuote, true);
  assert.equal(res.body.status, 'quote_ready');
  const session = getSession(id);
  assert.equal(session.quoteJson.projectId, 'CLIENT_01');
});

test('message endpoint hides provider error details from clients', async () => {
  const id = await createSession();
  setAnthropicClient({
    messages: {
      create: async () => {
        throw new Error('provider exploded with details');
      },
    },
  });

  const res = makeRes();
  await handleSessionMessage({
    params: { id },
    body: { message: 'Need help with this wall' },
    files: [],
  }, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'Unexpected server error');
});

test('email draft uses scenario and signer settings', () => {
  const draft = buildEmailDraft({
    emailRecipient: 'client@example.com',
    emailMeta: {
      scenario: 'quote_promise',
      scenarioManual: true,
      signer: 'Graeme',
      detailLevel: 'minimal',
      language: 'english',
    },
    quoteJson: {
      clientName: 'Jane Client',
      projectId: 'CLIENT_01',
      address: '123 Test St',
    },
    messages: [],
  });

  assert.match(draft.subject, /Quote Coming Soon/);
  assert.match(draft.body, /haven’t forgotten about your quote|haven't forgotten about your quote/i);
  assert.match(draft.body, /Graeme/);
  assert.equal(draft.recipient, 'client@example.com');
  assert.equal(draft.settings.scenario, 'quote_promise');
});

test('email draft auto-suggests scenario from session context until manually overridden', () => {
  const autoDraft = buildEmailDraft({
    emailMeta: {
      signer: 'Loric',
      detailLevel: 'standard',
      language: 'english',
    },
    quoteJson: {
      clientName: 'Jane Client',
      projectId: 'CLIENT_01',
      address: '123 Test St',
    },
    messages: [
      { role: 'assistant', content: 'Please find the revised quote attached.' },
    ],
  });

  assert.equal(autoDraft.settings.scenario, 'quote_revision');
  assert.match(autoDraft.subject, /Revised Quote/);

  const manualDraft = buildEmailDraft({
    emailMeta: {
      scenario: 'quote_send',
      scenarioManual: true,
      signer: 'Loric',
      detailLevel: 'standard',
      language: 'english',
    },
    quoteJson: {
      clientName: 'Jane Client',
      projectId: 'CLIENT_01',
      address: '123 Test St',
    },
    messages: [
      { role: 'assistant', content: 'Please find the revised quote attached.' },
    ],
  });

  assert.equal(manualDraft.settings.scenario, 'quote_send');
  assert.equal(manualDraft.settings.suggestedScenario, 'quote_revision');
  assert.match(manualDraft.subject, /Painting Quote/);
});
