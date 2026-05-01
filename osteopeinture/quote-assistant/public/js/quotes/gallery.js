// OP Hub — Gallery Functions
// Depends on: state.js, shared.js, panel.js

// ── ATTACHMENTS GALLERY ─────────────────────────────────────
async function loadSessionAttachments(sessionId) {
  try {
    const res = await fetch('/api/sessions/' + sessionId + '/attachments');
    const files = await res.json();
    loadGalleryImages(files);
  } catch (e) { loadGalleryImages([]); }
}

// ── IMAGE GALLERY (in quote panel) ──────────────────────────
function toggleGalleryView() {
  if (galleryState.visible) hideGallery();
  else showGallery();
}

function updateGalleryButtons() {
  updatePanelButtons();
}

function showGallery() {
  if (!galleryState.images.length) return;
  setPanelMode('gallery');
  selectGalleryImage(galleryState.currentIndex);
}

function hideGallery() {
  const frame = document.getElementById('quote-frame');
  if (draftQuoteJson) {
    setPanelMode('draft');
  } else if (frame.src || frame.srcdoc) {
    setPanelMode('pdf');
  } else {
    setPanelMode('placeholder');
  }
}

function loadGalleryImages(attachments) {
  galleryState.images = (attachments || []).filter(a => a.content_type && a.content_type.startsWith('image/'));
  galleryState.currentIndex = 0;
  if (galleryState.images.length > 0) {
    // Build carousel thumbnails
    const carousel = document.getElementById('gallery-carousel');
    carousel.innerHTML = galleryState.images.map((img, i) =>
      '<img src="' + esc(img.public_url) + '" class="' + (i === 0 ? 'selected' : '') + '" onclick="selectGalleryImage(' + i + ')" alt="' + esc(img.original_name || '') + '">'
    ).join('');
    // If no quote exists, show gallery by default
    const frame = document.getElementById('quote-frame');
    if (!frame.src && !frame.srcdoc) {
      showGallery();
    } else {
      updateGalleryButtons();
    }
  } else {
    if (galleryState.visible) hideGallery();
    updateGalleryButtons();
  }
}

function selectGalleryImage(index) {
  if (index < 0 || index >= galleryState.images.length) return;
  galleryState.currentIndex = index;
  const img = galleryState.images[index];
  document.getElementById('gallery-preview-img').src = img.public_url;
  // Update carousel selection
  const thumbs = document.querySelectorAll('#gallery-carousel img');
  thumbs.forEach((t, i) => t.classList.toggle('selected', i === index));
  // Scroll selected thumb into view
  if (thumbs[index]) thumbs[index].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  // Update count
  document.getElementById('gallery-count').textContent = (index + 1) + ' / ' + galleryState.images.length;
  // Show/hide arrows
  document.getElementById('gallery-prev').style.display = index > 0 ? '' : 'none';
  document.getElementById('gallery-next').style.display = index < galleryState.images.length - 1 ? '' : 'none';
}

function galleryNav(delta) {
  selectGalleryImage(galleryState.currentIndex + delta);
}

// ── DELETE ATTACHMENT ────────────────────────────────────────
async function deleteAttachment(attachmentId) {
  if (!confirm('Delete this image?')) return;
  try {
    const res = await fetch('/api/attachments/' + attachmentId, { method: 'DELETE' });
    if (!res.ok) { alert('Delete failed'); return; }
    // Remove from gallery state and re-render
    galleryState.images = galleryState.images.filter(img => img.id !== attachmentId);
    if (galleryState.currentIndex >= galleryState.images.length) {
      galleryState.currentIndex = Math.max(0, galleryState.images.length - 1);
    }
    if (galleryState.images.length === 0) {
      hideGallery();
      updateGalleryButtons();
    } else {
      loadGalleryImages(galleryState.images);
      selectGalleryImage(galleryState.currentIndex);
    }
  } catch (e) { alert('Error: ' + e.message); }
}

// Keyboard navigation for gallery
document.addEventListener('keydown', (e) => {
  if (!galleryState.visible) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.key === 'ArrowLeft') { galleryNav(-1); e.preventDefault(); }
  if (e.key === 'ArrowRight') { galleryNav(1); e.preventDefault(); }
  if (e.key === 'Escape') { hideGallery(); e.preventDefault(); }
});

// Mobile swipe on gallery preview
(function initGallerySwipe() {
  let startX = 0;
  const el = document.getElementById('gallery-preview');
  if (!el) return;
  el.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    const diff = e.changedTouches[0].clientX - startX;
    if (Math.abs(diff) > 50) galleryNav(diff > 0 ? -1 : 1);
  }, { passive: true });
})();
