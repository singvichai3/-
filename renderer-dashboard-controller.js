(function (global) {
  const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  const moduleApi = {
    async updateStats({ api, documentRef = document, renderDashboard }) {
      try {
        const stats = await api.getDashboardStats();
        const setEl = (id, val) => {
          const el = documentRef.getElementById(id);
          if (el) el.textContent = (val || 0).toLocaleString();
        };
        setEl('stat-today', stats.today);
        setEl('stat-pending', stats.pending);
        setEl('stat-received', stats.received);
        renderDashboard(stats);
      } catch (e) {
        // Silent to preserve legacy behavior
      }
    },

    async loadDashboard({ api, renderDashboard, consoleRef = console }) {
      try {
        const stats = await api.getDashboardStats();
        renderDashboard(stats);
      } catch (error) {
        consoleRef.error('Dashboard error:', error);
      }
    },

    renderDashboard({ documentRef = document, drawDashboardChart }, stats) {
      const shell = documentRef.getElementById('dashboard-shell');
      if (!shell) return;

      const byType = Array.isArray(stats?.byType) ? stats.byType : [];
      const carCount = byType.find(item => item.type === 'รย')?.count || 0;
      const motorCount = byType.find(item => item.type === 'จยย')?.count || 0;
      const total = Number(stats?.total || 0);
      const pending = Number(stats?.pending || 0);
      const received = Number(stats?.received || 0);
      const completionRate = total > 0 ? Math.round((received / total) * 100) : 0;
      const pendingRate = total > 0 ? Math.round((pending / total) * 100) : 0;
      const dailyItems = (stats?.daily || []).slice(-14);
      const maxDaily = Math.max(1, ...dailyItems.map(item => Number(item.count || 0)));

      const formatShortDate = (value) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value || '-';
        return `${date.getDate()} ${THAI_MONTHS[date.getMonth()]}`;
      };

      shell.innerHTML = `
        <div class="dashboard-grid">
            <div class="settings-card" style="padding:18px;">
                <div class="insight-title">รายการทั้งหมด</div>
                <div style="font-size:30px; font-weight:700; margin-top:8px;">${total.toLocaleString()}</div>
                <div class="advanced-summary" style="margin-top:8px;">ภาพรวมข้อมูลในระบบ</div>
            </div>
            <div class="settings-card" style="padding:18px;">
                <div class="insight-title">ยังไม่รับ</div>
                <div style="font-size:30px; font-weight:700; margin-top:8px; color: var(--red-500);">${pending.toLocaleString()}</div>
                <div class="advanced-summary" style="margin-top:8px;">คิดเป็น ${pendingRate}% ของทั้งหมด</div>
            </div>
            <div class="settings-card" style="padding:18px;">
                <div class="insight-title">รับแล้ว</div>
                <div style="font-size:30px; font-weight:700; margin-top:8px; color: var(--emerald-500);">${received.toLocaleString()}</div>
                <div class="advanced-summary" style="margin-top:8px;">สำเร็จ ${completionRate}%</div>
            </div>
            <div class="settings-card" style="padding:18px;">
                <div class="insight-title">เข้าวันนี้</div>
                <div style="font-size:30px; font-weight:700; margin-top:8px; color: var(--blue-500);">${Number(stats?.today || 0).toLocaleString()}</div>
                <div class="advanced-summary" style="margin-top:8px;">รายการที่นำเข้าวันนี้</div>
            </div>
        </div>
        <div class="dashboard-panels">
            <div class="dashboard-chart-card">
                <h3 style="margin-bottom:14px;">แนวโน้ม 14 วันล่าสุด</h3>
                <canvas id="dashboard-chart" width="960" height="320"></canvas>
            </div>
            <div style="display:grid; gap: 18px;">
                <div class="settings-card">
                    <h3 style="margin-bottom:14px;">สัดส่วนประเภทรถ</h3>
                    <div class="settings-list">
                        <div class="settings-list-item" style="display:flex; justify-content:space-between; align-items:center;">
                            <span>🚗 รถยนต์</span>
                            <strong>${Number(carCount).toLocaleString()}</strong>
                        </div>
                        <div class="settings-list-item" style="display:flex; justify-content:space-between; align-items:center;">
                            <span>🏍️ จักรยานยนต์</span>
                            <strong>${Number(motorCount).toLocaleString()}</strong>
                        </div>
                    </div>
                </div>
                <div class="settings-card">
                    <h3 style="margin-bottom:14px;">มุมมองผู้จัดการ</h3>
                    <div class="settings-list">
                        <div class="settings-list-item">ถ้ายังค้างรับสูงกว่า 30% ควรไล่ติดตามคิวที่ค้างก่อน</div>
                        <div class="settings-list-item">วันที่มีรับเข้าเยอะจะเห็นแท่งกราฟสูงขึ้นทันที</div>
                        <div class="settings-list-item">สามารถกลับไปหน้า รายการทั้งหมด เพื่อแก้ข้อมูลผิดและติดตามสถานะต่อได้ทันที</div>
                    </div>
                </div>
            </div>
        </div>
    `;

      drawDashboardChart(dailyItems, formatShortDate, maxDaily);
    },

    drawDashboardChart({ documentRef = document, windowRef = global }, dailyItems, formatShortDate, maxDaily) {
      const canvas = documentRef.getElementById('dashboard-chart');
      if (!canvas) return;

      const context = canvas.getContext('2d');
      if (!context) return;

      const ratio = windowRef.devicePixelRatio || 1;
      const cssWidth = canvas.clientWidth || 960;
      const cssHeight = 280;
      canvas.width = Math.floor(cssWidth * ratio);
      canvas.height = Math.floor(cssHeight * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const isLight = documentRef.body?.getAttribute('data-theme') === 'light';
      const stroke = isLight ? '#2563eb' : '#60a5fa';
      const fill = isLight ? 'rgba(37, 99, 235, 0.12)' : 'rgba(96, 165, 250, 0.16)';
      const grid = isLight ? 'rgba(100, 116, 139, 0.18)' : 'rgba(148, 163, 184, 0.16)';
      const text = isLight ? '#334155' : '#cbd5e1';
      const accent = isLight ? '#10b981' : '#34d399';

      context.clearRect(0, 0, cssWidth, cssHeight);

      if (!dailyItems.length) {
        context.fillStyle = text;
        context.font = '600 14px Sarabun';
        context.fillText('ยังไม่มีข้อมูลย้อนหลังสำหรับแสดงกราฟ', 24, 40);
        return;
      }

      const padding = { top: 18, right: 20, bottom: 42, left: 34 };
      const chartWidth = cssWidth - padding.left - padding.right;
      const chartHeight = cssHeight - padding.top - padding.bottom;
      const stepX = dailyItems.length > 1 ? chartWidth / (dailyItems.length - 1) : chartWidth;

      context.strokeStyle = grid;
      context.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = padding.top + (chartHeight / 4) * i;
        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(padding.left + chartWidth, y);
        context.stroke();
      }

      const points = dailyItems.map((item, index) => {
        const value = Number(item.count || 0);
        const x = padding.left + stepX * index;
        const y = padding.top + chartHeight - (value / Math.max(1, maxDaily)) * chartHeight;
        return { x, y, value, label: formatShortDate(item.date) };
      });

      context.beginPath();
      context.moveTo(points[0].x, padding.top + chartHeight);
      points.forEach((point) => context.lineTo(point.x, point.y));
      context.lineTo(points[points.length - 1].x, padding.top + chartHeight);
      context.closePath();
      context.fillStyle = fill;
      context.fill();

      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      points.forEach((point) => context.lineTo(point.x, point.y));
      context.strokeStyle = stroke;
      context.lineWidth = 3;
      context.stroke();

      points.forEach((point) => {
        context.beginPath();
        context.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
        context.fillStyle = '#ffffff';
        context.fill();
        context.strokeStyle = accent;
        context.lineWidth = 2;
        context.stroke();
      });

      context.fillStyle = text;
      context.font = '12px Sarabun';
      context.textAlign = 'center';
      points.forEach((point) => {
        context.fillText(point.label, point.x, cssHeight - 14);
      });

      context.textAlign = 'left';
      context.font = '700 12px Sarabun';
      context.fillText(String(maxDaily), 4, padding.top + 6);
      context.fillText('0', 12, padding.top + chartHeight);
    }
  };

  global.RendererDashboardControllerModule = moduleApi;
})(window);
