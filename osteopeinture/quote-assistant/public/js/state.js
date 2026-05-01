// OP Hub — Global Application State
// Single source of truth for all mutable state.
// All other scripts read/write these directly.

// Session state
var currentSessionId = null;
var currentSidebarMode = 'quotes';
var mobileCurrentView = 'chat';
var isRenaming = false;
var isSending = false;

// Quote state
var draftQuoteJson = null;
var quoteToggles = { lang: 'FR', scope: 'Interior', tier: 'High-end', prices: 'Paint prices', pricing: 'Fixed price' };
var toggleStateBySession = new Map();
var draftUndoStack = [];
var currentPanelMode = 'placeholder';
var draftSaveTimer = null;
var draftSaving = false;
var draftDirty = false;
var draftSaveVersion = 0;
var draftDragData = null;

// Job state
var currentJobId = null;
var convertingSessionId = null;
var jobOpenedFrom = null;
var invoiceEditorState = { jobId: null, docType: null, sections: [], paints: [], jobSectionsRaw: {} };
var mappingJobId = null;

// Gallery state
var galleryState = { images: [], currentIndex: 0, visible: false };

// Email state
var emailDraftStateBySession = new Map();
var stdEmailJobId = null;

// Smart paste state
var smartPasteJobId = null;
var smartPasteExtracted = null;

// Payment modal state
var paymentModalJobId = null;
var paymentModalJobNumber = '';
var paymentModalMethod = 'e_transfer';

// Attachment queue
var pendingFiles = [];
var pendingPreviewUrls = [];
var dragDepth = 0;

// Delete confirm state
var _deleteConfirmId = null;
var _deleteConfirmTimer = null;

// Cache state
var _sessionListCache = null;
var _sessionFetchInFlight = null;
var _jobsCache = null;
var _jobsFetchInFlight = null;

// Constants
var MAX_CLIENT_IMAGE_COUNT = 15;
