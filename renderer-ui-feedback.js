(function (global) {
  function escapeHTMLValue(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeGlobalHandlerName(value, fallback = 'undoLastAction') {
    const candidate = String(value || fallback);
    return /^[A-Za-z_$][\w$]*$/.test(candidate) ? candidate : fallback;
  }

  const moduleApi = {
    showUndoToast({ undoHandlerName = 'undoLastAction' }, message) {
      const el = document.getElementById('undo-toast');
      if (!el) return;
      const safeHandlerName = sanitizeGlobalHandlerName(undoHandlerName);
      el.innerHTML = `${escapeHTMLValue(message)}<button class="toast-undo-btn" onclick="${safeHandlerName}()">↩️ ยกเลิก</button>`;
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 5000);
    },

    showNotification(_ctx, message, type = 'info', duration = 3000) {
      const toast = document.getElementById('toast');
      if (!toast) return;

      const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
      toast.innerHTML = `<span class="toast-icon">${icons[type] || ''}</span><span>${escapeHTMLValue(message)}</span>`;
      toast.className = `show ${type}`;
      if (toast._hideTimer) clearTimeout(toast._hideTimer);
      toast._hideTimer = setTimeout(() => {
        toast.className = '';
        toast._hideTimer = null;
      }, duration);
    },

    showLoading({ setLoadingProgress }, text = 'กำลังประมวลผล...') {
      const overlay = document.getElementById('loading-overlay');
      const textEl = document.getElementById('loading-text');
      if (overlay) overlay.classList.add('show');
      if (textEl) textEl.textContent = text;
      setLoadingProgress(null);
    },

    hideLoading({ setLoadingProgress }) {
      const overlay = document.getElementById('loading-overlay');
      if (overlay) overlay.classList.remove('show');
      setLoadingProgress(null);
    },

    showLoadingProgress({ setLoadingProgress }, text, percent) {
      const overlay = document.getElementById('loading-overlay');
      const textEl = document.getElementById('loading-text');
      if (overlay) overlay.classList.add('show');
      if (textEl && text) textEl.textContent = text;
      setLoadingProgress(percent);
    },

    setLoadingProgress(_ctx, percent) {
      const container = document.getElementById('loading-progress-container');
      const fill = document.getElementById('loading-progress-fill');
      const text = document.getElementById('loading-progress-text');

      if (percent === null || typeof percent === 'undefined') {
        if (container) container.style.display = 'none';
        if (text) text.style.display = 'none';
        if (fill) fill.style.width = '0%';
        return;
      }

      const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
      if (container) container.style.display = 'block';
      if (text) {
        text.style.display = 'block';
        text.textContent = `${safePercent}%`;
      }
      if (fill) fill.style.width = `${safePercent}%`;
    },

    async finalizePostImportSync({
      State,
      showLoadingProgress,
      switchView,
      loadData,
      updateStats,
      hideLoading,
      api,
      restoreInteractiveStateAfterImport
    }) {
      State.pendingInteractionRecovery = true;
      showLoadingProgress('กำลังเปิดหน้ารายการล่าสุด...', 78);
      switchView('list', {
        keepLoadingOverlay: true,
        preserveLoadingState: true,
        skipListRefresh: true
      });

      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 60)));

      showLoadingProgress('กำลังโหลดข้อมูลค้นหา...', 86);
      await loadData({ includeInsights: true, includeTotal: true });

      showLoadingProgress('กำลังอัปเดตสถิติ...', 96);
      await updateStats();

      showLoadingProgress('พร้อมใช้งาน', 100);
      await new Promise(resolve => setTimeout(resolve, 180));
      hideLoading();

      if (api.resetWindowFocus) {
        try {
          await api.resetWindowFocus();
        } catch (error) {
          console.warn('resetWindowFocus error:', error);
        }
      }
      if (api.focusWindow) {
        try {
          await api.focusWindow();
        } catch (error) {
          console.warn('focusWindow error:', error);
        }
      }
      restoreInteractiveStateAfterImport();
    }
  };

  global.RendererUiFeedbackModule = moduleApi;
})(window);
