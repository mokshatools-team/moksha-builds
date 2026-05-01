// ── JOBS SIDEBAR ────────────────────────────────────

// Classify a job as ACTIVE / UPCOMING / PAST based on dates + status.
// PAST = completion_date set, OR status archived/completed/cancelled.
// UPCOMING = start_date set AND in the future.
// ACTIVE = everything else (started, no end yet — the default working set).
function classifyJob(j) {
  if (j.completion_date) return 'past';
  if (j.status && /^(archived|completed|cancelled|closed|declined)$/i.test(j.status)) return 'past';
  if (j.status === 'upcoming') return 'upcoming';
  const today = new Date().toISOString().slice(0, 10);
  if (j.start_date && j.start_date > today) return 'upcoming';
  return 'active';
}

function switchSidebarMode(mode) {
  currentSidebarMode = mode;
  const quotesMode = document.getElementById('sidebar-quotes-mode');
  const jobsMode = document.getElementById('sidebar-jobs-mode');
  const tabQ = document.getElementById('mode-tab-quotes');
  const tabJ = document.getElementById('mode-tab-jobs');
  const footer = document.getElementById('sidebar-footer');

  const mobileNav = document.getElementById('mobile-nav');

  if (mode === 'jobs') {
    quotesMode.style.display = 'none';
    jobsMode.style.display = '';
    tabQ.style.background = 'var(--surface-1)';
    tabQ.style.color = 'var(--text-3)';
    tabJ.style.background = 'var(--accent)';
    tabJ.style.color = '#fff';
    if (footer) footer.style.display = 'none';
    loadJobsSidebar();
    // Jobs = its own interface. Hide the Chat/Quote/Email bottom nav —
    // those tabs only apply to the quoting workflow. The jobs dashboard
    // fills the screen. User returns to quotes via the sidebar toggle.
    if (mobileNav) mobileNav.classList.add('jobs-mode-hidden');
    // Hide any quoting surfaces that might be open
    document.getElementById('quote-panel').classList.remove('mobile-open');
    document.getElementById('email-form').classList.remove('open');
    // Show jobs panel in main area and populate the dashboard
    document.getElementById('jobs-panel').classList.add('visible');
    loadJobs();
    mobileCurrentView = 'jobs';
  } else {
    quotesMode.style.display = '';
    jobsMode.style.display = 'none';
    tabQ.style.background = 'var(--accent)';
    tabQ.style.color = '#fff';
    tabJ.style.background = 'var(--surface-1)';
    tabJ.style.color = 'var(--text-3)';
    if (footer) footer.style.display = '';
    // Restore the Chat/Quote/Email bottom nav for the quoting workflow
    if (mobileNav) mobileNav.classList.remove('jobs-mode-hidden');
    // Hide jobs panel, show chat/quote
    document.getElementById('jobs-panel').classList.remove('visible');
    document.getElementById('job-detail').classList.remove('visible');
  }
}

async function loadJobsSidebar() {
  const list = document.getElementById('sidebar-jobs-list');
  const ribbonColors = { active: '#7a9a6a', upcoming: '#c49a5c', completed: '#6a8a9a', archived: '#666' };
  try {
    const jobs = await fetchJobs();
    if (!jobs.length) {
      list.innerHTML = '<div style="padding:16px;color:var(--text-3);font-size:12px;text-align:center;">No jobs yet.<br>Convert a quote to get started.</div>';
      return;
    }
    const buckets = { active: [], upcoming: [], completed: [], archived: [] };
    for (const j of jobs) {
      const cat = classifyJob(j);
      if (cat === 'past') buckets[j.status === 'archived' ? 'archived' : 'completed'].push(j);
      else buckets[cat].push(j);
    }
    function renderSidebarJob(j, color, dimmed) {
      const shortAddr = j.address ? j.address.split(',')[0].trim() : '';
      const isCash = j.payment_type === 'cash';
      const effectiveTotal = isCash && j.agreed_total_cents ? j.agreed_total_cents : j.quote_total_cents;
      const totalStr = effectiveTotal ? '$' + (effectiveTotal / 100).toLocaleString('fr-CA', {maximumFractionDigits:0}) : '';
      return `<div class="sidebar-item" onclick="openJobDetail('${j.id}','sidebar');closeSidebar();" style="cursor:pointer;border-left:3px solid ${color};padding-left:13px;${dimmed ? 'opacity:0.5;' : ''}">
        <div class="sidebar-item-client" style="font-family:var(--font-serif)">${esc(j.job_number)}</div>
        <div class="sidebar-item-meta">
          <span class="sidebar-item-id">${esc(shortAddr)}</span>
          <span class="sidebar-item-total">${totalStr}${isCash ? ' <span style="font-size:9px;color:var(--text-4)">cash</span>' : ''}</span>
        </div>
      </div>`;
    }
    function sectionLabel(label) {
      return '<div style="padding:14px 16px 6px;font-size:9px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--text-4);font-family:var(--font-sans);">' + label + '</div>';
    }
    let html = '';
    if (buckets.active.length) {
      html += sectionLabel('Active Jobs');
      html += buckets.active.map(j => renderSidebarJob(j, ribbonColors.active, false)).join('');
    }
    if (buckets.upcoming.length) {
      html += sectionLabel('Upcoming');
      html += buckets.upcoming.map(j => renderSidebarJob(j, ribbonColors.upcoming, false)).join('');
    }
    if (buckets.completed.length) {
      html += sectionLabel('Completed');
      html += buckets.completed.map(j => renderSidebarJob(j, ribbonColors.completed, true)).join('');
    }
    if (buckets.archived.length) {
      html += sectionLabel('Archived');
      html += buckets.archived.map(j => renderSidebarJob(j, ribbonColors.archived, true)).join('');
    }
    list.innerHTML = html;
  } catch (err) {
    list.innerHTML = '<div style="padding:16px;color:var(--accent)">Error: ' + esc(err.message) + '</div>';
  }
}
