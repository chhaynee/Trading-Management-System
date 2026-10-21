/**
 * forms.js — Centered modal-dialog primitives shared by account/strategy/journal forms.
 */

import { el, customSelect, confirmDialog } from './utils.js';

let activePanel = null;
let titleSeq = 0;

async function closePanel(force = false) {
  if (!activePanel) return;
  if (activePanel.submitting && !force) return;
  if (!force) {
    const isClean = !activePanel.dirty;
    if (!isClean) {
    const ok = await confirmDialog({
      title: activePanel.draftKey ? 'Keep this draft for later?' : 'Discard changes?',
      message: activePanel.draftKey ? 'Your draft stays in this browser until you save the entry.' : 'Your unsaved edits will be lost.',
      confirmLabel: activePanel.draftKey ? 'Keep draft & close' : 'Discard',
      cancelLabel: 'Keep editing',
      danger: !activePanel.draftKey,
    });
    if (!ok) return;
    }
  }
  if (!activePanel) return;
  activePanel.persistDraft?.();
  const { overlay, panel, onKey, releaseFocus, prevOverflow, prevFocus } = activePanel;
  document.removeEventListener('keydown', onKey, true);
  overlay.classList.remove('open');
  panel.classList.remove('open');
  document.body.style.overflow = prevOverflow;
  releaseFocus?.();
  setTimeout(() => {
    overlay.remove();
    if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
  }, 200);
  activePanel = null;
}

function trapFocus(panel) {
  const SEL = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function focusable() { return Array.from(panel.querySelectorAll(SEL)).filter(n => n.offsetParent !== null || n === document.activeElement); }
  function onKey(e) {
    if (e.key !== 'Tab') return;
    const items = focusable();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  panel.addEventListener('keydown', onKey);
  return () => panel.removeEventListener('keydown', onKey);
}

export function openFormPanel({ title, body, onSubmit, submitLabel = 'Save', onDelete = null, width = 560, draftKey = null }) {
  closePanel(true);
  const titleId = 'form-modal-title-' + (++titleSeq);

  const closeBtn = el('button', { class: 'form-close-btn', type: 'button', 'aria-label': 'Close' },
    el('span', { html: '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>' })
  );
  closeBtn.addEventListener('click', () => closePanel());

  const cancelBtn = el('button', { type: 'button', class: 'btn btn-ghost' }, 'Cancel');
  cancelBtn.addEventListener('click', () => closePanel());

  const submitBtn = el('button', { type: 'button', class: 'btn btn-primary' }, submitLabel);
  submitBtn.addEventListener('click', () => form.requestSubmit());

  const deleteBtn = onDelete
    ? el('button', { type: 'button', class: 'btn btn-ghost-danger' }, 'Delete')
    : null;
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Delete this entry?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    deleteBtn.disabled = true;
    submitBtn.disabled = true;
    if (activePanel) activePanel.submitting = true;
    try {
      await onDelete();
      saved = true;
      if (draftKey) localStorage.removeItem('tms-draft:' + draftKey);
      closePanel(true);
    } catch(err) {
      errorBox.textContent = err.message || 'Could not delete. Please retry.';
      errorBox.hidden = false;
      errorBox.focus();
    } finally {
      deleteBtn.disabled = false;
      submitBtn.disabled = false;
      if (activePanel) activePanel.submitting = false;
    }
  });

  const errorBox = el('div', { class: 'form-error', role: 'alert', tabindex: '-1', hidden: true });
  const draftStatus = el('div', { class: 'draft-status', role: 'status', 'aria-live': 'polite' }, draftKey ? 'Drafts stay in this browser until saved.' : '');
  let saved = false;
  let submitting = false;
  const form = el('form', { class: 'form-body', noValidate: true, onSubmit: async (e) => {
    e.preventDefault();
    if (submitting || !form.reportValidity()) return;
    if (form.querySelector('.uploading')) {
      errorBox.textContent = 'Wait for your screenshot upload to finish before saving.';
      errorBox.hidden = false;
      return;
    }
    if (form.querySelector('.upload-error')) {
      errorBox.textContent = 'A screenshot upload failed. Choose the image again before saving.';
      errorBox.hidden = false;
      return;
    }
    submitting = true;
    if (activePanel?.form === form) activePanel.submitting = true;
    errorBox.hidden = true;
    submitBtn.disabled = true;
    if (deleteBtn) deleteBtn.disabled = true;
    submitBtn.classList.add('loading');
    try {
      const r = onSubmit(e.target);
      if (r && r.then) await r;
      saved = true;
      if (draftKey) localStorage.removeItem('tms-draft:' + draftKey);
      closePanel(true);
    } catch (err) {
      errorBox.textContent = err.message || 'Could not save. Your changes are still here; please try again.';
      errorBox.hidden = false;
      errorBox.focus();
    }
    finally {
      submitting = false;
      if (activePanel?.form === form) activePanel.submitting = false;
      submitBtn.disabled = false;
      if (deleteBtn) deleteBtn.disabled = false;
      submitBtn.classList.remove('loading');
    }
  } },
    errorBox, draftKey ? draftStatus : null, body,
  );

  const footer = el('footer', { class: 'form-panel-footer' },
    deleteBtn,
    el('div', { class: 'form-panel-spacer' }),
    cancelBtn,
    submitBtn,
  );

  const panel = el('div', {
    class: 'form-panel',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
    style: { maxWidth: width + 'px' },
  },
    el('header', { class: 'form-panel-header' },
      el('h2', { id: titleId }, title),
      closeBtn,
    ),
    form,
    footer,
  );

  const overlay = el('div', { class: 'form-overlay' }, panel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel(); });

  const prevFocus = document.activeElement;
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.body.appendChild(overlay);

  const releaseFocus = trapFocus(panel);
  const onKey = (e) => {
    if (document.querySelector('[role="alertdialog"]')) return;
    if (e.key === 'Escape') { e.preventDefault(); closePanel(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); }
  };
  document.addEventListener('keydown', onKey, true);

  function persistDraft() {
    if (!draftKey || saved || !activePanel?.dirty) return;
    try {
      const values = Object.fromEntries([...new FormData(form)].filter(([, value]) => typeof value === 'string'));
      localStorage.setItem('tms-draft:' + draftKey, JSON.stringify({ values, savedAt: Date.now() }));
      draftStatus.textContent = 'Draft saved on this device · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      draftStatus.textContent = 'Draft could not be stored. Keep this form open until you save.';
    }
  }
  activePanel = { overlay, panel, onKey, releaseFocus, prevOverflow, prevFocus, draftKey, persistDraft, dirty: false };

  // Track unsaved changes for the confirm-on-close guard
  const onEdit = () => { if (activePanel?.form === form) { activePanel.dirty = true; persistDraft(); } };
  activePanel.form = form;
  form.addEventListener('input', onEdit);
  form.addEventListener('change', onEdit);

  // Animate in + focus first field
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    panel.classList.add('open');
    const firstInput = panel.querySelector('input:not([type=hidden]), textarea, select, [tabindex]:not([tabindex="-1"])');
    firstInput?.focus();
  });
  return { form, panel, overlay };
}

// ── Common form field builders ────────────────────────
export function field(label, control, help) {
  return el('label', { class: 'form-field' },
    el('span', { class: 'form-label' }, label),
    control,
    help ? el('span', { class: 'form-help' }, help) : null
  );
}

export function textInput({ name, value = '', placeholder = '', required = false, type = 'text' }) {
  return el('input', { type, name, value, placeholder, required: required ? 'required' : null, class: 'text-input' });
}

export function numberInput({ name, value = '', placeholder = '', min, max, step = 'any', required = false }) {
  return el('input', { type: 'number', name, value, placeholder, min, max, step, required: required ? 'required' : null, class: 'text-input number-input' });
}

export function textArea({ name, value = '', placeholder = '', rows = 4 }) {
  return el('textarea', { name, placeholder, rows, class: 'text-input textarea' }, value);
}

export function select({ name, value, options, required = false }) {
  const hidden = el('input', { type: 'hidden', name, value: value || '' });
  if (required) hidden.setAttribute('required', 'required');
  const dropdown = customSelect(options, value, (v) => { hidden.value = v; hidden.dispatchEvent(new Event('input', { bubbles: true })); });
  dropdown.removeAttribute('aria-label');
  if (required) dropdown.required = true;
  const wrap = el('div', { class: 'form-select-wrap' }, hidden, dropdown);
  return wrap;
}

export function multiChips({ options, values = [], name }) {
  const wrap = el('div', { class: 'chip-select', dataset: { name } });
  const selected = new Set(values);
  const hidden = el('input', { type: 'hidden', name, value: Array.from(selected).join(',') });
  options.forEach(opt => {
    const label = typeof opt === 'string' ? opt : opt.label;
    const val   = typeof opt === 'string' ? opt : opt.value;
    const chip = el('button', { type: 'button', class: 'chip' + (selected.has(val) ? ' active' : ''), onClick: () => {
      if (selected.has(val)) { selected.delete(val); chip.classList.remove('active'); }
      else                   { selected.add(val);    chip.classList.add('active'); }
      hidden.value = Array.from(selected).join(',');
      chip.setAttribute('aria-pressed', String(selected.has(val)));
      hidden.dispatchEvent(new Event('input', { bubbles: true }));
    } }, label);
    wrap.appendChild(chip);
  });
  wrap.appendChild(hidden);
  return wrap;
}

export function colorPicker({ name, value, colors }) {
  const wrap = el('div', { class: 'color-picker' });
  const hidden = el('input', { type: 'hidden', name, value });
  colors.forEach(c => {
    const s = el('button', { type: 'button', class: 'color-swatch' + (c === value ? ' active' : ''), style: { background: c }, 'aria-label': c });
    s.addEventListener('click', () => {
      hidden.value = c;
      hidden.dispatchEvent(new Event('input', { bubbles: true }));
      wrap.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('active'));
      s.classList.add('active');
    });
    wrap.appendChild(s);
  });
  wrap.appendChild(hidden);
  return wrap;
}

export function imageUpload({ name, value = '', onChange }) {
  const wrap = el('div', { class: 'image-upload' });
  const hidden = el('input', { type: 'hidden', name, value });
  const preview = el('div', { class: 'image-upload-preview' + (value ? ' has-image' : '') });
  if (value) {
    if (value.startsWith('idb://')) {
      // IDB-stored screenshots aren't browser-renderable; resolve to a blob URL for display
      // while keeping the canonical idb:// path on the hidden input for save.
      (async () => {
        try {
          const { resolveScreenshotUrl } = await import('./db.js');
          const url = await resolveScreenshotUrl(value);
          if (url) preview.style.backgroundImage = `url(${url})`;
        } catch (err) { console.error('Preview resolve failed', err); }
      })();
    } else {
      preview.style.backgroundImage = `url(${value})`;
    }
  }
  const placeholder = el('div', { class: 'image-upload-placeholder' },
    el('span', { html: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' })
  );
  preview.appendChild(placeholder);
  const fileInput = el('input', { type: 'file', accept: 'image/*', class: 'image-upload-input' });
  // Make preview focusable so it can own paste events + keyboard activation
  preview.setAttribute('tabindex', '0');

  async function handle(file) {
    if (!file) return;
    const localUrl = URL.createObjectURL(file);
    preview.classList.remove('upload-error');
    preview.style.backgroundImage = `url(${localUrl})`;
    preview.classList.add('has-image', 'uploading');
    try {
      const { uploadScreenshot, resolveScreenshotUrl } = await import('./db.js');
      const serverPath = await uploadScreenshot(file);
      hidden.value = serverPath;
      hidden.dispatchEvent(new Event('input', { bubbles: true }));
      // IDB returns `idb://...` (not browser-renderable); resolve to blob URL for preview.
      const displayUrl = serverPath.startsWith('idb://')
        ? await resolveScreenshotUrl(serverPath)
        : serverPath;
      if (displayUrl) preview.style.backgroundImage = `url(${displayUrl})`;
      onChange?.(serverPath);
    } catch (err) {
      console.error('Upload failed', err);
      preview.classList.add('upload-error');
      preview.setAttribute('aria-label', 'Screenshot upload failed. Activate to retry.');
    } finally {
      URL.revokeObjectURL(localUrl);
      preview.classList.remove('uploading');
    }
  }
  fileInput.addEventListener('change', (e) => handle(e.target.files[0]));
  preview.addEventListener('click', () => fileInput.click());
  preview.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  preview.addEventListener('dragover', (e) => { e.preventDefault(); preview.classList.add('dragover'); });
  preview.addEventListener('dragleave', () => preview.classList.remove('dragover'));
  preview.addEventListener('drop', (e) => { e.preventDefault(); preview.classList.remove('dragover'); handle(e.dataTransfer.files[0]); });

  // --- Paste-from-clipboard support ---
  // Arm the global paste listener only while the cursor is over (or focus is in) the dropzone,
  // so pasting into other inputs on the form still works normally.
  function extractImage(e) {
    const items = e.clipboardData?.items;
    if (!items) return null;
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) return it.getAsFile();
    }
    return null;
  }
  function onPaste(e) {
    const file = extractImage(e);
    if (!file) return;
    e.preventDefault();
    handle(file);
    preview.classList.add('pasted');
    setTimeout(() => preview.classList.remove('pasted'), 450);
  }
  let armed = false;
  function arm()   { if (!armed) { document.addEventListener('paste', onPaste); armed = true;  preview.classList.add('armed'); } }
  function disarm(){ if (armed)  { document.removeEventListener('paste', onPaste); armed = false; preview.classList.remove('armed'); } }
  preview.addEventListener('mouseenter', arm);
  preview.addEventListener('mouseleave', () => { if (document.activeElement !== preview) disarm(); });
  preview.addEventListener('focus', arm);
  preview.addEventListener('blur',  () => { if (!preview.matches(':hover')) disarm(); });

  wrap.appendChild(preview);
  wrap.appendChild(fileInput);
  wrap.appendChild(hidden);
  return wrap;
}

export function toggleGroup({ name, value, options }) {
  const wrap = el('div', { class: 'toggle-group' });
  const hidden = el('input', { type: 'hidden', name, value });
  options.forEach(opt => {
    const btn = el('button', { type: 'button', class: 'toggle-btn' + (opt.value === value ? ' active' : '') }, opt.label);
    btn.addEventListener('click', () => {
      hidden.value = opt.value;
      hidden.dispatchEvent(new Event('input', { bubbles: true }));
      wrap.querySelectorAll('.toggle-btn').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
    });
    wrap.appendChild(btn);
  });
  wrap.appendChild(hidden);
  return wrap;
}

/**
 * Reads a form's values into a plain object.
 *  - chipFields: comma-separated chip inputs become arrays
 *  - jsonFields: hidden inputs whose value is a JSON string become parsed objects
 */
export function readForm(form, chipFields = [], jsonFields = []) {
  const fd = new FormData(form);
  const obj = {};
  for (const [k, v] of fd.entries()) {
    if (chipFields.includes(k))      obj[k] = v ? v.split(',').filter(Boolean) : [];
    else if (jsonFields.includes(k)) { try { obj[k] = v ? JSON.parse(v) : null; } catch { obj[k] = null; } }
    else                             obj[k] = v;
  }
  return obj;
}
