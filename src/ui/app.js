'use strict';

const api = window.apkstart;
const $ = (id) => document.getElementById(id);

const state = {
  apps: [],
  settings: null,
  status: null,
  filter: '',
  installing: false,
  setupBusy: null,
  menuPkg: null,
};

/* ---------------- 工具 ---------------- */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function initialOf(label) {
  const t = String(label || '?').trim();
  return (t[0] || '?').toUpperCase();
}

function fmtSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

function relTime(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  if (d < 60000) return 'Vừa xong';
  if (d < 3600000) return `${Math.floor(d / 60000)} phút trước`;
  if (d < 86400000) return `${Math.floor(d / 3600000)} giờ trước`;
  if (d < 86400000 * 30) return `${Math.floor(d / 86400000)} ngày trước`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

/**
 * 迷你 toast
 *
 * 同一类消息做去重 + 数量上限：
 * 安装失败时里面有「运行时启动日志」在持续推送，以前每条都新建一个 toast，
 * 于是屏幕上会不停叠加同一条错误，看起来像「失败信息一直循环」。
 */
let _toastSeq = 0;
function toast({ title, body = '', type = 'info', progress = null, sticky = false, spinner = false }) {
  const wrap = $('toastWrap');
  // ① 去重：同样的标题 + 正文（4 秒内）只刷新那一条，不叠加
  const key = `${title}|${body}`;
  const dup = [...wrap.children].find((n) => n.dataset.key === key && Date.now() - Number(n.dataset.at || 0) < 4000);
  if (dup) {
    dup.dataset.at = String(Date.now());
    return {
      el: dup,
      dismiss: () => dup.remove(),
      update: ({ title: t2, body: b2 } = {}) => {
        if (t2 !== undefined) dup.querySelector('.t-title-text').textContent = t2;
        if (b2 !== undefined) dup.querySelector('.t-body').textContent = b2;
      },
    };
  }
  // ② 上限：同时最多 4 条，超出先挤掉最旧的
  while (wrap.children.length >= 4) wrap.firstElementChild.remove();

  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.dataset.key = key;
  el.dataset.at = String(Date.now());
  el.dataset.seq = String(++_toastSeq);
  el.innerHTML = `
    <div class="t-title">
      ${spinner ? '<span class="spinner"></span>' : ''}
      <span class="t-title-text">${esc(title)}</span>
    </div>
    <div class="t-body">${esc(body)}</div>
    ${progress === null ? '' : '<div class="bar"><i></i></div>'}
  `;
  $('toastWrap').appendChild(el);

  const dismiss = () => {
    el.style.transition = 'opacity .18s, transform .18s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(4px)';
    setTimeout(() => el.remove(), 200);
  };

  const ctl = {
    el, dismiss,
    update({ title: t2, body: b2, progress: p2, type: ty } = {}) {
      if (t2 !== undefined) el.querySelector('.t-title-text').textContent = t2;
      if (b2 !== undefined) el.querySelector('.t-body').textContent = b2;
      if (p2 !== undefined && el.querySelector('.bar i')) {
        el.querySelector('.bar i').style.width = `${Math.max(2, Math.min(100, p2))}%`;
      }
      if (ty === 'error') el.classList.add('error');
      if (ty === 'ok') {
        el.querySelector('.spinner')?.remove();
        el.classList.remove('error');
      }
    },
  };

  if (!sticky) setTimeout(dismiss, type === 'error' ? 6000 : 3200);
  return ctl;
}

/* ---------------- 渲染 ---------------- */

function visibleApps() {
  const q = state.filter.trim().toLowerCase();
  if (!q) return state.apps;
  return state.apps.filter((a) => (
    a.label.toLowerCase().includes(q)
    || a.package.toLowerCase().includes(q)
  ));
}

function renderGrid() {
  const apps = visibleApps();
  const grid = $('grid');
  const empty = $('empty');

  const hasAny = state.apps.length > 0;
  grid.classList.toggle('hidden', apps.length === 0);
  empty.classList.toggle('hidden', apps.length > 0);

  if (!hasAny) {
    const s = state.status;
    $('emptyHint').textContent = s && s.adbOk === false
      ? 'Lần đầu sử dụng: Mở Cài đặt góc trên bên phải → Môi trường chạy → Hoàn tất 1 chạm, sau đó quay lại cài đặt ứng dụng.'
      : 'Gợi ý: Tất cả ứng dụng dùng chung 1 Android runtime, nên từ ứng dụng thứ 2 mở gần như tức thì.';
    grid.innerHTML = '';
    return;
  }

  // 末尾放一块「添加应用」虚线卡片。
  // 目的不只是好看：应用少的时候下面是一大片空白，用户不知道该干什么；
  // 这块卡片把「还能拖 APK 进来」这件事直接摆在眼前，也顺手填掉了空白。
  grid.innerHTML = apps.map((a) => `
    <div class="card" data-pkg="${esc(a.package)}" title="${esc(a.label)} · ${esc(a.package)}">
      ${a.pinned ? '<span class="pin">★</span>' : ''}
      ${a.running ? '<span class="badge-run" title="Đang chạy"></span>' : ''}
      <div class="icon">
        ${a.iconUrl
          ? `<img src="${esc(a.iconUrl)}" alt="" draggable="false" />`
          : `<div class="fallback" style="background:${esc(a.accent || '#9aa6b2')}">${esc(initialOf(a.label))}</div>`}
      </div>
      <div class="name">${esc(a.label)}</div>
      <div class="meta">${a.running ? 'Đang chạy' : `v${esc(a.versionName)}${a.lastLaunchAt ? ' · ' + relTime(a.lastLaunchAt) : ''}`}</div>
      <div class="open-hint">${a.running ? 'Đưa lên trước' : 'Mở'}</div>
    </div>
  `).join('') + `
    <div class="card card-add" id="cardAdd" role="button" tabindex="0" title="Kéo thả file APK vào đây, hoặc click để chọn">
      <div class="add-plus" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round"><path d="M12 6v12"/><path d="M6 12h12"/></svg>
      </div>
      <div class="name">Thêm ứng dụng</div>
      <div class="meta">Kéo thả file APK để cài đặt</div>
    </div>
  `;
}

/* ---------------- 数据刷新 ---------------- */

async function refreshApps() {
  try {
    state.apps = await api.listApps();
    renderGrid();
    updateStats();
  } catch (e) {
    console.error(e);
  }
}

function updateStats() {
  const n = state.apps.length;
  $('statusStats').textContent = n ? `${n} ứng dụng` : 'Chưa có ứng dụng';
}

async function refreshStatus() {
  try {
    state.status = await api.runtimeStatus();
    const s = state.status;
    const dot = $('statusDot');
    const text = $('statusText');
    const tag = $('engineTag');

    if (!s.adbOk) {
      dot.className = 'dot err';
      text.textContent = 'Runtime chưa triển khai —— Mở Cài đặt → Runtime để cài đặt';
      tag.textContent = 'Cần triển khai';
      tag.className = 'brand-tag';
    } else if (s.deviceOnline) {
      dot.className = 'dot ok';
      text.textContent = `Môi trường đã sẵn sàng · Android ${s.android || '?'}${s.freeform ? ' · Cửa sổ độc lập đã bật' : ''}`;
      tag.textContent = `Android ${s.android || ''}`.trim();
      tag.className = 'brand-tag ok';
    } else if (s.phase === 'booting' || s.vmStarting) {
      dot.className = 'dot warn';
      text.textContent = 'Đang khởi động Android…';
      tag.textContent = 'Đang nạp…';
      tag.className = 'brand-tag';
    } else if (s.needsSetup === 'accel') {
      dot.className = 'dot warn';
      // 说清「怎么修」而不是只说「没开」——这句是状态条上最容易被看到的位置
      text.textContent = 'Chưa bật tăng tốc phần cứng. Hãy kiểm tra máy để bật';
      tag.textContent = 'Mô phỏng';
      tag.className = 'brand-tag';
    } else if (s.needsSetup === 'sysimg') {
      dot.className = 'dot err';
      text.textContent = 'Thiếu ảnh hệ thống Android 14 —— Mở Cài đặt để tải';
      tag.textContent = 'Chờ tải ảnh hệ thống';
      tag.className = 'brand-tag';
    } else if (s.needsSetup === 'emulator') {
      dot.className = 'dot err';
      text.textContent = 'Chưa cài engine Runtime —— Mở Cài đặt để cài';
      tag.textContent = 'Cần triển khai';
      tag.className = 'brand-tag';
    } else if (s.needsSetup === 'boot') {
      dot.className = 'dot warn';
      text.textContent = 'Runtime đã sẵn sàng —— Kéo thả file APK vào để cài đặt';
      tag.textContent = 'Sẵn sàng';
      tag.className = 'brand-tag';
    } else if (s.installing) {
      dot.className = 'dot warn';
      text.textContent = 'Trình cài đặt đang chạy —— Vui lòng hoàn tất trong cửa sổ máy ảo';
      tag.textContent = 'Đang cài đặt';
      tag.className = 'brand-tag';
    } else {
      dot.className = 'dot';
      text.textContent = s.installed
        ? 'Runtime ở chế độ chờ (Cài đặt hoặc mở app sẽ tự khởi động)'
        : 'Chưa cài đặt hệ điều hành Android —— Mở Cài đặt để tiếp tục';
      tag.textContent = s.installed ? 'Chế độ chờ' : 'Chờ cài đặt';
      tag.className = 'brand-tag';
    }
    $('statusDevice').textContent = s.deviceOnline ? (s.serial || '') : '';
    // 网络状态：这是用户最容易踩的坑（应用里一直「网络错误」，但看不出是虚拟机没网）。
    // 直接摆在状态栏，出问题时一眼能看到，不用去翻日志。
    const netEl = $('statusNet');
    const netSep = $('statusNetSep');
    if (netEl) {
      const show = !!s.deviceOnline && !!s.network;
      netEl.hidden = !show;
      if (netSep) netSep.hidden = !show;
      if (show) {
        netEl.textContent = s.network.ok ? `Mạng bình thường ${s.network.ip || ''}`.trim() : 'Máy ảo chưa có mạng';
        netEl.className = 'status-item status-net ' + (s.network.ok ? 'ok' : 'warn');
        netEl.title = s.network.ok
          ? 'Máy ảo Android đã kết nối mạng thành công'
          : 'Máy ảo Android chưa có mạng, trang trực tuyến sẽ bị trắng hoặc báo lỗi. Có thể vào「Cài đặt → Khắc phục mạng」để xử lý';
      }
    }

    renderSetup(s);
  } catch (e) {
    $('statusText').textContent = `Kiểm tra trạng thái thất bại: ${e.message}`;
  }
}

/* ---------------- 运行时部署（固定在设置里） ---------------- */

/**
 * 运行时/部署/自检面板现在都收在「设置」里，主界面只留已安装应用。
 * 保留 showSetup 给托盘菜单与 ui:navigate 复用，语义改为「打开设置并定位到运行时」。
 */
function showSetup(on) {
  if (!on) { $('setupGuide').hidden = true; return; }
  openSettings().then(() => {
    const box = $('runtimeGroup');
    if (box) box.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }).catch(() => {});
}

function fmtGB(n) { return n ? `${(n / 1073741824).toFixed(2)} GB` : ''; }

function stepRow(opt) {
  const cls = ['step'];
  if (opt.done) cls.push('done');
  if (opt.busy) cls.push('busy');
  return `
    <div class="${cls.join(' ')}" data-step="${opt.key}">
      <div class="idx">${opt.done ? '✓' : opt.index}</div>
      <div class="body">
        <div class="t">${esc(opt.title)}${opt.tag ? `<span class="tag ${opt.req ? 'req' : ''}">${esc(opt.tag)}</span>` : ''}</div>
        <div class="d" data-desc>${esc(opt.desc)}</div>
        <div class="bar"><i data-bar></i></div>
      </div>
      <div class="act">${opt.actions || ''}</div>
    </div>`;
}

function renderSetup(s) {
  if (!s) return;
  const env = s.env || {};
  const hv = env.hypervisor || {};
  const accel = env.accel || s.accel || {};

  // 启动即见已安装应用：不再用部署向导整屏接管主界面，
  // 状态只在设置里的运行时面板 + 底部状态条上体现。
  const accelOk = accel.ok || hv.whpx;
  const adbDone = !!(env.adb && env.adb.ok);
  const emuDone0 = !!(env.emulator && env.emulator.ok);
  const imgDone0 = !!(env.sysimg && env.sysimg.ok);
  const allDone0 = adbDone && emuDone0 && imgDone0;
  const stateText = $('setupStateText');
  if (stateText) {
    const missing = [];
    if (!adbDone) missing.push('adb');
    if (!emuDone0) missing.push('Công cụ ảo hóa');
    if (!imgDone0) missing.push('Ảnh hệ thống');
    stateText.textContent = s.deviceOnline
      ? `Đã sẵn sàng · Android ${s.android || ''}`
      : s.phase === 'booting' || s.vmStarting
        ? 'Đang khởi động Android…'
        : allDone0
          ? 'Đầy đủ thành phần · Chờ khởi động (tự động bật khi mở app)'
          : `Thiếu ${missing.join(', ')}${accelOk ? '' : ' (không có tăng tốc phần cứng, dùng mô phỏng)'}`;
    stateText.title = s.autoProfile || accel.note || hv.note || '';
  }

  const emuDone = !!(env.emulator && env.emulator.ok);
  const imgDone = !!(env.sysimg && env.sysimg.ok);
  const busy = state.setupBusy;
  const booting = s.phase === 'booting';

  // 只保留一个步骤：下载、参数自适应、开机全部由「一键完成」串起来，
  // 且首次启动会在后台自动跑，用户不需要逐步点击。
  const allDone = !!(env.adb && env.adb.ok) && emuDone && imgDone;
  const left = [];
  if (!(env.adb && env.adb.ok)) left.push('Bộ công cụ adb');
  if (!emuDone) left.push('Môi trường Android');
  if (!imgDone) left.push('Ảnh hệ thống');
  const step = {
    key: 'all',
    index: 1,
    title: allDone ? 'Tất cả đã sẵn sàng' : 'Hoàn tất một chạm',
    tag: allDone ? 'Đã hoàn tất tự động' : 'Tự động',
    done: allDone,
    busy: !!busy,
    desc: s.deviceOnline
      ? `Android ${s.android || ''} đã sẵn sàng · Cửa sổ sẽ tự căn chỉnh theo màn hình`
      : booting
        ? 'Đang khởi động Android…'
        : allDone
          ? 'Thành phần đầy đủ, nhấp đúp file APK/XAPK hoặc icon Desktop sẽ tự động bật máy'
          : `Còn thiếu ${left.join(', ')}; bấm「Hoàn tất một chạm」bên dưới để tự động cài đặt và khởi động`,
    actions: s.deviceOnline
      ? '<button class="btn ghost sm" data-act="vmStop">Dừng môi trường</button>'
      : '',
  };

  $('setupSteps').innerHTML = stepRow(step);
  $('btnDeployAll').disabled = !!busy;
  $('btnDeployAll').textContent = busy ? 'Đang chuẩn bị…' : (allDone ? 'Đã hoàn tất · Bấm để kiểm tra lại' : 'Hoàn tất một chạm');
  // 「上次为什么没起来」优先显示落盘的失败记录：进程重启后内存里的 diagnosis 是空的，
  // 只显示 autoProfile 会让用户完全看不出原因（issue #20/#25 的报告就是这样）。
  const lf = s.lastFailure;
  const lastMsg = (lf && lf.diagnosis && lf.diagnosis.title)
    ? `Lần khởi động trước thất bại: ${lf.diagnosis.title}`
    : (s.diagnosis ? `Chẩn đoán tự động lần khởi động trước: ${s.diagnosis.title}` : '');
  $('setupNote').textContent = lastMsg
    || s.autoProfile || 'Hoàn toàn tự động: Không cần chọn ảnh hệ thống, không cần chỉnh tăng tốc hay RAM';
}

function store_getDiskSize() {
  return (state.settings && state.settings.runtime && state.settings.runtime.diskSizeGB) || 24;
}

function setStepBusy(key, on) {
  state.setupBusy = on ? key : null;
  // 五步已合并成一行，所有子步骤的进度都落在这唯一的进度条上
  const row = $('setupSteps').querySelector('[data-step="all"]');
  if (row) {
    row.classList.toggle('busy', !!on);
    if (on) {
      const bar = row.querySelector('[data-bar]');
      if (bar) bar.style.width = '3%';
    }
  }
}

function updateStepProgress(component, p) {
  if (!component) return;
  const row = $('setupSteps').querySelector('[data-step="all"]');
  if (!row) return;
  if (p.percent !== undefined) {
    const bar = row.querySelector('[data-bar]');
    if (bar) bar.style.width = `${Math.max(3, Math.min(100, p.percent))}%`;
  }
  if (p.message) {
    const d = row.querySelector('[data-desc]');
    if (d) d.textContent = p.message;
  }
}

async function deployAll() {
  if (state.setupBusy) return;
  setStepBusy('all', true);
  try {
    // 一次调用把 adb / 引擎 / 系统镜像全装完，进度统一显示在唯一那一行
    // 用户点「一键部署」属于明确的手动重试，绕过失败冷却
    const r = await api.autoDeploy({ force: true });
    if (!r || !r.ok) {
      toast({ title: 'Chuẩn bị thất bại', body: (r && r.error) || 'Vui lòng kiểm tra kết nối mạng rồi thử lại', type: 'error', sticky: true });
      return;
    }
    await refreshStatus();
    toast({ title: 'Thành phần đã sẵn sàng, đang khởi động máy ảo…', body: 'Lần đầu mất khoảng 1-3 phút, các lần sau chỉ vài giây.', type: 'info' });
    const started = await api.runtimeStart();
    await refreshStatus();
    toast(started && started.ok
      ? { title: 'Môi trường đã sẵn sàng', body: 'Bây giờ bạn có thể kéo thả APK/XAPK vào cửa sổ hoặc nhấp đúp icon trên Desktop.', type: 'ok' }
      : { title: 'Khởi động chưa hoàn tất', body: (started && started.error) || 'Vui lòng xuất báo cáo chẩn đoán để kiểm tra nguyên nhân', type: 'error', sticky: true });
  } catch (e) {
    toast({ title: 'Chuẩn bị thất bại', body: e.message, type: 'error', sticky: true });
  } finally {
    setStepBusy('all', false);
    await refreshStatus();
    selfCheck();
  }
}

async function runStep(key) {
  if (state.setupBusy) return { ok: false, error: 'Đang có tác vụ triển khai đang chạy' };
  setStepBusy(key, true);
  let r;
  try {
    if (key === 'adb') r = await api.installAdb();
    else if (key === 'emulator') r = await api.installEmulator();
    else if (key === 'sysimg') r = await api.installSysimg();
    else if (key === 'accel') {
      const t = toast({
        title: 'Đang cài trình điều khiển tăng tốc phần cứng…',
        body: 'Vui lòng chọn Yes trong cửa sổ phân quyền Admin',
        sticky: true,
        spinner: true,
      });
      r = await api.enableAccel();
      if (r.ok) t.update({ title: 'Tăng tốc phần cứng đã được kích hoạt', type: 'ok' });
      else t.update({ title: 'Chưa kích hoạt tăng tốc phần cứng', body: r.error, type: 'error', sticky: true });
    } else if (key === 'qemu') r = await api.installQemu();
    else if (key === 'iso') r = await api.downloadIso();
    else if (key === 'disk') r = await api.createDisk(store_getDiskSize());
    else r = { ok: false, error: 'Bước không xác định' };
  } catch (e) {
    r = { ok: false, error: e.message };
  }
  setStepBusy(key, false);
  await refreshStatus();
  return r;
}

async function startInstall() {
  const r = await api.startInstaller();
  if (!r.ok) {
    toast({ title: 'Không thể khởi động môi trường cài đặt', body: r.error, type: 'error', sticky: true });
    return;
  }
  $('setupGuide').hidden = false;
  $('setupGuide').scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast({ title: 'Cửa sổ máy ảo đã mở', body: 'Thực hiện 6 bước để hoàn tất; sau khi cài xong bấm「Tôi đã cài đặt xong」.', type: 'ok', sticky: true });
}

async function markInstalled() {
  await api.markInstalled();
  await api.runtimeStop();
  $('setupGuide').hidden = true;
  await refreshStatus();
  toast({ title: 'Cài đặt hoàn tất, môi trường đã tiếp quản', body: 'Bây giờ bạn có thể kéo thả trực tiếp tệp APK/XAPK vào để cài đặt.', type: 'ok' });
}



/* ---------------- 安装 ---------------- */

/** 把安装失败翻译成「下一步该做什么」，只对最常见的几种做提示，其它原样显示 */
function friendlyInstallErrorText(msg) {
  const s = String(msg || 'Lỗi không xác định');
  if (/INSUFFICIENT_STORAGE|not enough space|không đủ bộ nhớ|hết dung lượng|ENOSPC/i.test(s)) {
    return `${s}\nPhân vùng dữ liệu Android không đủ: Cài đặt → Hiệu năng & Tài nguyên → Tăng dung lượng dữ liệu rồi bấm「Mở rộng ngay」.`;
  }
  if (/NO_MATCHING_ABIS/i.test(s)) return 'Ứng dụng này chỉ chứa thư viện ARM 32-bit (armeabi-v7a). Hệ thống hiện tại là Android 14 64-bit (hỗ trợ x86_64 và arm64-v8a). Vui lòng tải phiên bản arm64-v8a của game hoặc cài trực tiếp qua Google Play.'; 
  if (/INSTALL_FAILED_ALREADY_EXISTS|signatures do not match/i.test(s)) {
    return `${s}\nCùng tên gói nhưng khác chữ ký chứng thực. Nhấp chuột phải vào ứng dụng chọn「Gỡ cài đặt」rồi cài lại.`;
  }
  if (/INSTALL_FAILED_VERSION_DOWNGRADE/i.test(s)) return `${s}\nPhiên bản đã cài đặt cao hơn, vui lòng gỡ cài đặt từ menu chuột phải trước khi cài lại.`;
  if (/ERR_FS_FILE_TOO_LARGE|greater than possible Buffer|Cannot allocate|ENOMEM|out of memory/i.test(s)) {
    return `${s}\nGói cài đặt quá lớn hoặc thiếu bộ nhớ, phân tích bị từ chối. Vui lòng kiểm tra dung lượng ổ đĩa và RAM rồi thử lại; nếu vẫn thất bại hãy chuyển tệp sang đường dẫn tiếng Anh ngắn (ví dụ: D:\\a.apk).`;
  }
  return s;
}

/* 当前那条「正在安装…」的 sticky 提示。install:error 事件要能把它收掉：
 * 主进程是先 send('install:error') 再让 invoke 失败的，两者都可能到得很晚，
 * 只靠 catch 收会出现「报错了右下角还在转圈」。 */
let installToast = null;

async function installFiles(paths) {
  if (!paths || !paths.length) return;
  if (state.installing) {
    toast({ title: 'Đang có tác vụ cài đặt khác đang chạy', body: 'Vui lòng đợi ứng dụng hiện tại cài xong rồi tiếp tục.' });
    return;
  }
  state.installing = true;
  let ok = 0;
  let failed = 0;

  for (const p of paths) {
    const name = p.split(/[\\/]/).pop();
    const t = toast({ title: `Đang cài đặt ${name}`, body: 'Đang phân tích gói cài đặt…', progress: 8, sticky: true, spinner: true });
    installToast = t;
    let off = () => {};
    try {
      off = api.on('install:progress', (pr) => {
        const base = { parse: 12, 'parse-done': 24, runtime: 38, install: 62, shortcut: 88, done: 100 }[pr.stage] || 50;
        const pct = pr.percent != null ? Math.min(60, Math.round((pr.percent / 100) * 60)) : base;
        t.update({ title: pr.meta ? `Đang cài đặt ${pr.meta.label}` : `Đang cài đặt ${name}`, body: pr.message, progress: pct });
      });
      const r = await api.installApk(p);
      t.update({ title: `Đã cài đặt ${r.app.label}`, body: r.app.shortcutPath ? 'Đã tạo lối tắt trên Desktop, nhấp đúp để mở trực tiếp.' : 'Có thể nhấp chuột phải vào ứng dụng để tạo lối tắt Desktop.', progress: 100, type: 'ok' });
      t.el.querySelector('.spinner')?.remove();
      setTimeout(t.dismiss, 3600);
      if (r.warnings && r.warnings.length) {
        toast({ title: `${r.app.label} Thông báo tương thích`, body: r.warnings.join(' '), type: 'error', sticky: false });
      }
      ok++;
    } catch (e) {
      failed++;
      // 先把那条「正在安装…」的 sticky 提示收掉，否则它会一直转圈、还继续被
      // 运行时日志刷新 —— 用户看到的就是「失败信息一直在循环」。
      // 错误提示统一由下面的 install:error 监听器负责（带文件名与中文原因），
      // 这里不再重复弹一条。
      try { off(); } catch (_) { /* ignore */ }
      t.dismiss();
      if (installToast === t) installToast = null;
    } finally {
      try { off(); } catch (_) { /* ignore */ }
    }
  }

  state.installing = false;
  await refreshApps();
  if (ok && !failed) $('search').value = '';
}

/* ---------------- 应用操作 ---------------- */

async function launchApp(pkg) {
  const app = state.apps.find((a) => a.package === pkg);
  state.launchPkg = pkg;
  const t = toast({
    title: `Đang mở ${app ? app.label : pkg}`, 
    body: 'Lần đầu khởi động cần chuẩn bị môi trường, vui lòng đợi…',
    sticky: true,
    spinner: true,
  });
  const r = await api.launch(pkg);
  if (r.ok) {
    // 应用有自己的窗口，主界面自动收起；这里只留一句提示，然后隐藏窗口
    t.update({ title: 'Đã mở', body: 'Ứng dụng đang chạy trong cửa sổ độc lập (thanh trên cùng có thể xoay màn hình).', type: 'ok' });
    setTimeout(t.dismiss, 1600);
    setTimeout(() => api.winHide(), 900);
    setTimeout(refreshApps, 1200);
  } else {
    t.update({ title: 'Khởi động thất bại', body: r.error, type: 'error' });
    setTimeout(t.dismiss, 6000);
  }
}

async function createShortcut(pkg) {
  try {
    const r = await api.createShortcut(pkg);
    toast({ title: 'Đã tạo lối tắt trên Desktop', body: r.path, type: 'ok' });
    refreshApps();
  } catch (e) {
    toast({ title: 'Tạo lối tắt thất bại', body: e.message, type: 'error' });
  }
}

async function uninstall(pkg) {
  const app = state.apps.find((a) => a.package === pkg);
  if (!app) return;
  const ok = window.confirm(`Bạn có chắc chắn muốn gỡ cài đặt「${app.label}」?\n\nDữ liệu ứng dụng sẽ bị xóa sạch, lối tắt trên Desktop cũng sẽ bị xóa.`);
  if (!ok) return;
  try {
    await api.uninstall(pkg);
    toast({ title: 'Đã gỡ cài đặt', body: app.label, type: 'ok' });
    refreshApps();
  } catch (e) {
    toast({ title: 'Gỡ cài đặt thất bại', body: e.message, type: 'error' });
  }
}

/* ---------------- 右键菜单 ---------------- */

const MENU_ITEMS = [
  { key: 'open', label: 'Mở ứng dụng', kbd: 'Enter' },
  // 只在应用真的在运行时才出现（见 showMenu 里的过滤）。
  // 以前完全没有这一项，独立窗口模式下又没有可点的关闭按钮，
  // 应用一起来就关不掉，只能退到托盘退出整个 ApkStart。
  { key: 'stop', label: 'Đóng ứng dụng', onlyRunning: true },
  { key: 'shortcut', label: 'Tạo lối tắt Desktop' },
  { key: 'pin', label: 'Ghim lên đầu' },
  { key: 'keymap', label: 'Gán phím (Keymap)…' },
  { divider: true },
  { key: 'reveal', label: 'Mở thư mục chứa APK' },
  { key: 'clear', label: 'Xóa dữ liệu ứng dụng' },
  { divider: true },
  { key: 'uninstall', label: 'Gỡ cài đặt', danger: true },
];

function showMenu(x, y, pkg) {
  const menu = $('ctxmenu');
  state.menuPkg = pkg;
  const app = state.apps.find((a) => a.package === pkg);
  const items = MENU_ITEMS.filter((it) => !it.onlyRunning || (app && app.running));
  menu.innerHTML = items.map((it) => {
    if (it.divider) return '<div class="divider"></div>';
    const label = it.key === 'pin' ? (app && app.pinned ? 'Bỏ ghim' : 'Ghim lên đầu') : it.label;
    return `<div class="item ${it.danger ? 'danger' : ''}" data-key="${it.key}" data-act="${it.key}">
      <span>${esc(label)}</span>${it.kbd ? `<span class="k">${it.kbd}</span>` : ''}
    </div>`;
  }).join('');
  menu.classList.add('on');

  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 10)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 10)}px`;
}

function hideMenu() {
  $('ctxmenu').classList.remove('on');
  state.menuPkg = null;
}

async function handleMenu(act) {
  const pkg = state.menuPkg;
  const app = state.apps.find((a) => a.package === pkg);
  hideMenu();
  if (!app) return;
  switch (act) {
    case 'open': return launchApp(pkg);
    case 'stop': {
      try {
        const r = await api.stop(pkg);
        if (r && r.ok) {
          toast({ title: 'Đã đóng', body: app.label, type: 'ok' });
        } else {
          toast({ title: 'Đóng thất bại', body: (r && r.error) || 'Lỗi không xác định', type: 'error' });
        }
      } catch (e) {
        toast({ title: 'Đóng thất bại', body: e.message, type: 'error' });
      }
      return refreshApps();
    }
    case 'shortcut': return createShortcut(pkg);
    case 'pin': return api.pin(pkg, !app.pinned).then(refreshApps);
    case 'keymap': return showKeymapPicker(pkg, app.label);
    case 'reveal': return api.revealApk(pkg);
    case 'clear': {
      if (!window.confirm(`Xóa toàn bộ dữ liệu của「${app.label}」? Thao tác này không thể hoàn tác.`)) return;
      try {
        await api.clearData(pkg);
        toast({ title: 'Đã xóa dữ liệu', body: app.label, type: 'ok' });
      } catch (e) {
        toast({ title: 'Xóa dữ liệu thất bại', body: e.message, type: 'error' });
      }
      return;
    }
    case 'uninstall': return uninstall(pkg);
    default: return undefined;
  }
}

/**
 * 按键映射预设选择器。用 confirm + prompt 做最简交互（不引入新 UI 组件）。
 * 后续可以做成更精致的弹窗编辑器。
 */
async function showKeymapPicker(pkg, label) {
  try {
    const presets = await api.keymap.getPresets();
    const current = await api.keymap.getMap(pkg);
    const hasCurrent = current && current.length > 0;
    const lines = presets.map((p, i) => `${i + 1}. ${p.label} — ${p.desc}`);
    if (hasCurrent) lines.unshift('0. Xóa cấu hình gán phím hiện tại');
    const msg = `Chọn cấu hình gán phím cho「${label}」:\n\n${lines.join('\n')}\n\nNhập số thứ tự:`;
    const input = window.prompt(msg, hasCurrent ? '0' : '1');
    if (input === null) return; // 取消
    const idx = parseInt(input, 10);
    if (hasCurrent && idx === 0) {
      await api.keymap.setMap(pkg, []);
      toast({ title: 'Đã xóa gán phím', body: label, type: 'ok' });
      return;
    }
    const presetIdx = hasCurrent ? idx - 1 : idx;
    if (presetIdx < 1 || presetIdx > presets.length) {
      toast({ title: 'Số thứ tự không hợp lệ', type: 'error' });
      return;
    }
    const chosen = presets[presetIdx - 1];
    await api.keymap.applyPreset(pkg, chosen.id);
    toast({ title: `Đã áp dụng「${chosen.label}」`, body: `${label} · Mở ứng dụng để điều khiển bằng bàn phím`, type: 'ok' });
  } catch (e) {
    toast({ title: 'Cài đặt gán phím thất bại', body: e.message, type: 'error' });
  }
}

/* ---------------- 设置 ---------------- */

// ---------------- 安卓系统设置 ----------------

let volumeTimer = null;

async function refreshAndroid() {
  const el = $('androidStatus');
  if (!el) return;
  el.textContent = 'Đang đọc…';
  const r = await api.android.status().catch(() => null);
  if (!r || !r.ok) {
    el.textContent = r && r.error ? `Môi trường chưa sẵn sàng (${String(r.error).slice(0, 36)})` : 'Môi trường chưa khởi động';
    return;
  }
  el.textContent = `Android ${r.sdk || '?'} · ${r.wifi ? 'Wi-Fi: Bật' : 'Wi-Fi: Tắt'}` +
    `${r.airplane ? ' · Chế độ máy bay' : ''} · Âm lượng ${r.volume}%`;
  $('setAndroidWifi').checked = !!r.wifi;
  $('setAndroidAirplane').checked = !!r.airplane;
  $('setAndroidAnim').checked = !r.animationsOff;
  $('setAndroidVolume').value = r.volume;
  $('androidVolumeText').textContent = `${r.volume}%`;
  if (r.fontScale) $('setAndroidFont').value = Number(r.fontScale).toFixed(2);
  if (r.density) {
    const opt = [...$('setAndroidDensity').options].find((o) => o.value === String(r.density));
    if (opt) $('setAndroidDensity').value = String(r.density);
  }
}

function bindAndroid() {
  const set = async (key, value, msg) => {
    const r = await api.android.set(key, value).catch(() => null);
    toast({
      type: r && r.ok ? 'ok' : 'error',
      title: r && r.ok ? (msg || 'Đã áp dụng') : `Thất bại: ${(r && r.error) || 'Môi trường chưa sẵn sàng'}`,
    });
    if (r && r.ok) refreshAndroid();
  };
  $('setAndroidWifi').addEventListener('change', (e) => set('wifi', e.target.checked, e.target.checked ? 'Đã bật Wi-Fi' : 'Đã tắt Wi-Fi'));
  $('setAndroidAirplane').addEventListener('change', (e) => set('airplane', e.target.checked, e.target.checked ? 'Đã bật chế độ máy bay' : 'Đã tắt chế độ máy bay'));
  $('setAndroidAnim').addEventListener('change', (e) => set('animations', e.target.checked, e.target.checked ? 'Đã bật hiệu ứng động' : 'Đã tắt hiệu ứng động (giao diện mượt và nhanh hơn)'));
  $('setAndroidFont').addEventListener('change', (e) => set('fontScale', Number(e.target.value), 'Đã chỉnh kích thước phông chữ'));
  $('setAndroidDensity').addEventListener('change', (e) => set('density', Number(e.target.value), 'Đã chỉnh kích thước hiển thị'));
  $('setAndroidVolume').addEventListener('input', (e) => {
    $('androidVolumeText').textContent = `${e.target.value}%`;
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(() => set('volume', Number(e.target.value), 'Đã điều chỉnh âm lượng'), 260);
  });
  $('btnAndroidRefresh').addEventListener('click', () => refreshAndroid());
  $('btnAndroidTune').addEventListener('click', async () => {
    const r = await api.android.tune(state.launchPkg || '').catch(() => null);
    toast({ type: r && r.ok ? 'ok' : 'error', title: r && r.ok ? 'Đã tối ưu hóa: tắt hiệu ứng động, nới lỏng chạy nền' : 'Tối ưu hóa thất bại, môi trường có thể chưa khởi động' });
    if (r && r.ok) refreshAndroid();
  });
  const open = async (action) => {
    const r = await api.android.open(action).catch(() => null);
    if (!r || !r.ok) {
      toast({ type: 'error', title: 'Cần mở một ứng dụng trước để khởi động môi trường' });
    }
  };
  $('btnAndroidSettings').addEventListener('click', () => open('settings'));
  $('btnAndroidDisplay').addEventListener('click', () => open('display'));
  $('btnAndroidSound').addEventListener('click', () => open('sound'));
  $('btnAndroidLocale').addEventListener('click', () => open('locale'));
  $('btnAndroidApps').addEventListener('click', () => open('apps'));
}

/** 设置页字段同步：只剩自带运行时，所有资源项都露出来，不再按底座切换 */
function syncBackendFields() {
  const perf = $('perfGroup');
  if (perf) perf.hidden = false;
  refreshResources();
}

/** 本机资源上限 + 当前分配（设置页里那几行灰字） */
async function refreshResources() {
  const bNote = $('builtinResNote');
  if (!bNote) return;
  const gb = (mb) => (Number(mb) > 0 ? `${Math.round(Number(mb) / 1024)} GB` : 'Không rõ');
  const r = await api.resources().catch(() => null);
  if (!r || r.ok === false) {
    bNote.textContent = (r && (r.note || r.error)) || 'Tạm thời chưa đọc được thông tin phân bổ tài nguyên';
    return;
  }
  const host = r.host || {};
  const lim = r.limits || {};
  const free = Number(r.freeMB) || Number((r.current && r.current.freeMB) || 0);
  bNote.textContent = `Máy tính: ${gb(host.totalMB)} RAM / ${host.cores} nhân CPU;`
    + `RAM tối đa có thể cấp: ${gb(lim.maxMB)}, CPU tối đa: ${Math.max(1, (host.cores || 1) - 1)} nhân (chừa 1/4 RAM và 1 nhân cho Windows).`
    + `Giới hạn phân vùng dữ liệu: ${lim.maxGB || 0} GB${free ? ` (ổ đĩa còn trống ${(free / 1024).toFixed(1)} GB)` : ''}.`
    + (r.verdict && r.verdict.note ? ` ${r.verdict.note}` : '');
}

/** 本机体检：渲染报告（每条带等级点和可执行动作） */
function renderPreflight(res) {
  const list = $('preflightList');
  const sum = $('preflightSummary');
  const applyBtn = $('btnPreflightApply');
  if (!list) return;
  list.textContent = '';
  if (!res || !res.report) {
    if (sum) sum.textContent = (res && res.error) || 'Kiểm tra không có kết quả, vui lòng thử lại';
    return;
  }
  const { report, edition } = res;
  for (const it of report.items) {
    const item = document.createElement('div');
    item.className = 'pf-item';
    const head = document.createElement('div');
    head.className = 'pf-head';
    const dot = document.createElement('span');
    dot.className = `pf-dot ${it.level}`;
    const title = document.createElement('span');
    title.className = 'pf-title';
    title.textContent = it.title;
    head.append(dot, title);
    item.append(head);
    if (it.detail) {
      const d = document.createElement('div');
      d.className = 'pf-detail';
      d.textContent = it.detail;
      item.append(d);
    }
    if (it.action && it.action.kind === 'elevate') {
      const wrap = document.createElement('div');
      wrap.className = 'pf-action';
      const btn = document.createElement('button');
      btn.className = 'btn ghost sm';
      btn.textContent = it.action.label;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = 'Đang xử lý…';
        let r = null;
        if (it.action.id === 'accel') r = await api.enableAccel().catch(() => null);
        else r = await api.enableVirtualization().catch(() => null);
        btn.disabled = false;
        btn.textContent = old;
        if (!r) { toast({ type: 'error', title: 'Thao tác chưa hoàn thành', body: 'Bạn có thể thử lại sau hoặc làm theo hướng dẫn' }); return; }
        if (r.cancelled) toast({ type: 'warn', title: 'Đã hủy', body: 'Không có thay đổi nào đối với cài đặt hệ thống' });
        else if (r.ok || r.already) {
          const reboot = r.restartNeeded === true;
          toast({
            type: 'ok',
            title: r.already ? 'Tăng tốc phần cứng đã sẵn sàng' : (reboot ? 'Đã áp dụng, cần khởi động lại máy' : 'Đã có hiệu lực'),
            body: r.already ? '' : (reboot ? 'Khởi động lại máy tính để tăng tốc có hiệu lực, sau đó kiểm tra lại' : 'Có thể nhấn Kiểm tra để xác nhận kết quả'),
          });
          if (r.already || !reboot) setTimeout(() => runPreflight().catch(() => {}), 1200);
        } else {
          toast({ type: 'error', title: 'Chưa thể tự động hoàn thành', body: (r.error || r.note || 'Vui lòng làm theo hướng dẫn thủ công') });
        }
      });
      wrap.append(btn);
      item.append(wrap);
    } else if (it.action && it.action.kind === 'manual') {
      const wrap = document.createElement('div');
      wrap.className = 'pf-action pf-detail';
      wrap.textContent = `⚠ ${it.action.label}`;
      item.append(wrap);
    }
    list.append(item);
  }
  const rec = report.recommended || {};
  if (sum) {
    sum.textContent = `${report.summary}. Cấu hình đề xuất: RAM ${Math.round((rec.memoryMB || 0) / 1024)} GB / `
      + `${rec.cores || 2} nhân / Màn hình ${rec.renderSize || 'tự động'} · Dựng hình ${rec.gpuMode || 'tự động'}`
      + (edition === 'store' ? ' (Bản Store: bật tính năng ảo hóa trong Windows Features)' : '');
  }
  if (applyBtn) applyBtn.hidden = false;
}

async function runPreflight() {
  const btn = $('btnPreflight');
  const sum = $('preflightSummary');
  if (!btn) return null;
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Đang kiểm tra…';
  if (sum) sum.textContent = 'Đang kiểm tra ảo hóa, card màn hình, RAM… (khoảng 2~3 giây)';
  let r = null;
  try {
    r = await api.preflightRun();
  } catch (e) {
    r = { error: e.message || 'Kiểm tra thất bại' };
  }
  btn.disabled = false;
  btn.textContent = old;
  renderPreflight(r);
  return r;
}

/** 驱动（兼容补丁）：渲染清单 + 命中状态 */
function renderDrivers(r) {
  const list = $('drvList');
  const sum = $('drvSummary');
  if (!list) return;
  const host = (r && r.host) || {};
  const drivers = (r && r.drivers) || [];
  const errors = (r && r.errors) || [];
  const onCount = drivers.filter((d) => d.enabled && d.matched).length;
  if (sum) {
    const accel = host.accel === 'none' ? 'Không có tăng tốc phần cứng' : (host.accel || 'Không rõ');
    sum.textContent = `Máy tính: ${host.platform || ''}/${host.arch || ''} · GPU ${host.gpuVendor || 'Không rõ'} · ${accel}`
      + ` · Trình giả lập ${host.emulatorVersion || 'Không rõ'}; Trình điều khiển: ${drivers.length}, đang kích hoạt: ${onCount}.`
      + (errors.length ? ` ${errors.length} tệp tải thất bại.` : '');
  }
  list.textContent = '';
  for (const d of drivers) {
    const item = document.createElement('div');
    item.className = d.enabled ? 'drv-item on' : 'drv-item';

    const head = document.createElement('div');
    head.className = 'drv-head';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!d.enabled;
    cb.addEventListener('change', async () => {
      const res = await api.driversSetEnabled(d.id, cb.checked).catch(() => null);
      if (res && res.ok && res.overview) renderDrivers(res.overview);
      else { cb.checked = !cb.checked; toast({ type: 'error', title: 'Lưu thất bại', body: (res && res.error) || 'Vui lòng thử lại sau' }); }
    });
    const name = document.createElement('span');
    name.className = 'drv-name';
    name.textContent = d.name;
    head.append(cb, name);

    if (d.matched && d.enabled) {
      const b = document.createElement('span');
      b.className = 'drv-badge hit';
      b.textContent = 'Đã áp dụng';
      head.append(b);
    }
    if (d.builtin) {
      const b = document.createElement('span');
      b.className = 'drv-badge';
      b.textContent = 'Mẫu có sẵn';
      head.append(b);
    }
    item.append(head);

    const meta = document.createElement('div');
    meta.className = 'drv-meta';
    meta.textContent = `v${d.version || '?'}`
      + (d.author ? ` · ${d.author}` : '')
      + ` · priority ${d.priority}`
      + (d.hits && d.hits.length ? ` · Khớp: ${d.hits.join(' / ')}` : ' · Không khớp với máy này');
    item.append(meta);

    if (d.description) {
      const desc = document.createElement('div');
      desc.className = 'drv-meta';
      desc.textContent = d.description;
      item.append(desc);
    }
    list.append(item);
  }
  for (const e of errors) {
    const err = document.createElement('div');
    err.className = 'drv-err';
    err.textContent = `${String(e.file || '').split(/[\\/]/).pop()}：${(e.errors || []).join('；')}`;
    list.append(err);
  }
  if (!drivers.length && !errors.length) {
    const empty = document.createElement('div');
    empty.className = 'drv-meta';
    empty.textContent = 'Chưa có trình điều khiển nào. Có thể nhấn「Xuất mẫu máy tính」hoặc nhập tệp JSON.';
    list.append(empty);
  }
}

async function refreshDrivers() {
  if (!$('drvList')) return;
  const r = await api.driversList().catch(() => null);
  if (!r) {
    if ($('drvSummary')) $('drvSummary').textContent = 'Không đọc được danh sách trình điều khiển (môi trường có thể chưa cài đặt)';
    return;
  }
  renderDrivers(r);
}

function fillSettings(s) {
  syncBackendFields();
  refreshDrivers().catch(() => {});
  $('setAdbPath').value = s.adbPath || '';
  $('setSystemImage').value = s.runtime.isoPath || '';
  $('setMemory').value = s.engine.memoryMB;
  $('setCores').value = s.engine.cores;
  $('setIdle').value = s.engine.idleShutdownMinutes;
  if ($('setSourcePref')) $('setSourcePref').value = (s.runtime && s.runtime.sourcePreference) || 'auto';
  if ($('setAutoMirror')) $('setAutoMirror').checked = (s.runtime && s.runtime.autoMirror) !== false;
  if ($('setGiteeToken')) $('setGiteeToken').value = (s.runtime && s.runtime.giteeToken) || '';
  if ($('setMirrorPrefix')) $('setMirrorPrefix').value = (s.runtime && s.runtime.mirrorPrefix) || '';
  if ($('setConnections')) $('setConnections').value = Number((s.runtime && s.runtime.downloadConnections) || 8);
  $('setAudio').checked = s.engine.audio !== false;
  $('setLiteMode').checked = s.engine.liteMode !== false;
  $('setPrewarm').checked = s.engine.prewarm !== false;
  $('setPriorityMode').value = ['performance', 'game'].includes(s.engine.priorityMode)
    ? s.engine.priorityMode : 'balanced';
  $('setDeepTrim').checked = !!s.engine.deepTrim;
  $('setMouseRightBack').checked = s.engine.mouseRightBack !== false;
  $('setMouseWheelMode').value = ['smooth', 'native', 'off'].includes(s.engine.mouseWheelMode)
    ? s.engine.mouseWheelMode : 'smooth';
  $('setMouseSideButtons').checked = !!s.engine.mouseSideButtons;
  if ($('setKeymapEnabled')) $('setKeymapEnabled').checked = s.engine.keymapEnabled !== false;
  $('setCompat').checked = !!(s.runtime && s.runtime.compatImage);
  $('setAutoShortcut').checked = !!s.createShortcutOnInstall;
  $('setStartMenuShortcut').checked = s.createStartMenuShortcut !== false;
  $('setShortcutDir').value = s.shortcutDir || '';
  $('setSharedDir').value = s.sharedDir || '';
  $('setDeviceSharedDir').value = s.deviceSharedDir || '';
  const d = s.display || {};
  $('setAutoStart').checked = s.autoStart !== false;
  const eng = s.engine || {};
  if ($('setResourceMode')) $('setResourceMode').value = eng.resourceMode || 'balanced';
  if ($('setRenderSize')) $('setRenderSize').value = eng.renderSize || 'auto';
  if ($('setDataGB')) $('setDataGB').value = String(Number(eng.dataPartitionGB || 0));
  if ($('setFastDns')) $('setFastDns').checked = eng.fastDns !== false;
  if ($('setLocale')) $('setLocale').value = eng.locale || 'zh-CN';
  if ($('setChineseIme')) $('setChineseIme').checked = eng.chineseIme !== false;
  if ($('setKeepSnapshot')) $('setKeepSnapshot').checked = eng.keepSnapshot !== false;
  $('setDisplayMode').value = d.mode === 'fullscreen' ? 'fullscreen' : 'window';
  if ($('setAutoFullscreen')) $('setAutoFullscreen').value = d.autoFullscreenOnLaunch === true ? 'on' : 'off';
  if ($('setLandscape')) $('setLandscape').value = d.landscape === true ? 'landscape' : 'portrait';
  if ($('setOrientationMode')) $('setOrientationMode').value = d.orientationMode || 'auto';
  if ($('setTabletMode')) $('setTabletMode').value = d.tabletMode === false ? 'off' : 'on';
  $('setPortrait').value = d.portrait || '900x1600';
  if ($('setWindowEmbed')) $('setWindowEmbed').value = d.windowEmbed === false ? 'detached' : 'embed';
  $('portraitField').hidden = $('setDisplayMode').value === 'fullscreen';
}

/** 数据分区实际大小 + 磁盘余量，显示在设置页容量选择下方 */
async function refreshDataInfo() {
  const el = $('dataNote');
  if (!el) return;
  const info = await api.dataInfo().catch(() => null);
  if (!info) { el.textContent = 'Đọc thông tin phân vùng dữ liệu thất bại'; return; }
  const auto = Number(($('setDataGB') || {}).value || 0) === 0;
  // 有 quickboot 差量盘时底座镜像的大小不等于 guest 看到的容量（实测 8GB 镜像、guest 5.7GB），
  // 与其显示一个会误导人的数字，不如明确说「以运行时为准」。
  const img = info.overlay
    ? 'Ổ đĩa vi sai Quickboot (dung lượng thực tế tính theo /data)'
    : (info.fsGB ? `Hệ thống tệp thực tế: ${info.fsGB} GB` : (info.imageGB ? `${info.imageGB} GB` : 'Chưa tạo'));
  const free = info.freeDiskMB ? `${(info.freeDiskMB / 1024).toFixed(1)} GB` : 'Không rõ';
  const pending = Number(info.pendingGB) > 0
    ? ` Mục tiêu ${info.configuredGB} GB chưa có hiệu lực: Android đang dùng Quickboot, cần「Đặt lại dữ liệu」để tạo lại (sẽ xóa app đã cài).`
    : '';
  el.textContent = `Phân vùng dữ liệu hiện tại: ${img}${auto ? ' (Tự động)' : ''} · Dung lượng ổ đĩa còn trống: ${free}. ${pending}`
    + 'Nếu game báo không đủ bộ nhớ, hãy tăng dung lượng ở đây rồi bấm「Mở rộng ngay」; mở rộng trực tiếp sẽ không làm mất ứng dụng.';
}

async function openSettings() {
  state.settings = await api.getSettings();
  fillSettings(state.settings);
  const info = await api.info();
  $('setRuntimeDir').value = info.runtimeDir || info.dataDir;
  if ($('setAvdDir')) {
    const di = await api.dataInfo().catch(() => null);
    $('setAvdDir').value = (di && di.avdDir) || '';
  }
  const verEl = document.getElementById('aboutVer');
  if (verEl && info.version) verEl.textContent = `v${info.version}`;
  const curVerEl = document.getElementById('updateCurrent');
  if (curVerEl && info.version) curVerEl.textContent = `v${info.version}`;
  const assoc = await api.assocStatus();
  const btn = $('btnAssoc');
  btn.textContent = assoc.registered ? 'Đã liên kết · Nhấp để hủy' : 'Chưa liên kết · Nhấp để bật';
  btn.dataset.on = assoc.registered ? '1' : '0';

  api.doctorProfile().then((r) => {
    if (r && r.text) $('autoProfileText').textContent = r.text;
  }).catch(() => { $('autoProfileText').textContent = 'Chế độ tự động'; });
  api.runtimeUsage().then((u) => {
    $('usageText').textContent = u
      ? `Tổng cộng: ${u.totalText}${u.reclaimable ? ` · Có thể dọn dẹp ${u.reclaimableText} (${u.count} mục)` : ' · Đã tối ưu hoàn toàn'}`
      : 'Thống kê không khả dụng';
  }).catch(() => { $('usageText').textContent = 'Thống kê không khả dụng'; });

  $('settingsMask').classList.add('on');
  refreshAndroid();
  refreshDataInfo();
}

function closeSettings() {
  $('settingsMask').classList.remove('on');
}

/* ---------------- 软件更新 ---------------- */

let lastUpdate = null;

/** 把一次检查结果画到设置面板（也用于启动时静默检查推送过来的状态） */
function renderUpdate(info) {
  lastUpdate = info || null;
  const cur = $('updateCurrent');
  const st = $('updateState');
  const btn = $('btnDoUpdate');
  const bar = $('updateBar');
  if (!cur || !st || !btn) return;
  if (!info) return;
  if (info.current) cur.textContent = `v${info.current}`;

  if (info.ok === false) {
    st.textContent = `Kiểm tra thất bại: ${info.error || 'Mạng không khả dụng'}`;
    // 检查失败也要给一条出路：直接把发布页打开，用户至少能手动下载。
    // 以前这里是「什么都不显示」，用户只会觉得「更新功能坏了」。
    showUpdateBtn(true);
    btn.textContent = 'Mở trang tải xuống';
    btn.dataset.mode = 'manual';
    lastUpdate = { htmlUrl: info.htmlUrl || '' };
    if (bar) bar.hidden = true;
    return;
  }
  if (info.hasUpdate) {
    // 如实说明这次是哪个源给出的版本、另一个源为什么没参与 ——
    // 用户排查「为什么检查更新很慢」时，这一行比任何日志都直接。
    const src = (info.sources || []).map((x) => `${x.name} ${x.tag || ''}`.trim()).join(' / ');
    const bad = (info.unreachable || []).map((x) => x.name).join('、');
    const stale = info.stale ? ' (Bộ nhớ cache ngoại tuyến)' : '';
    st.textContent = `Đã có phiên bản mới ${info.tag}${src ? ` (${src})` : ''}${stale}`;
    showUpdateBtn(true);
    btn.textContent = info.asset ? 'Cập nhật ngay' : 'Mở trang tải xuống';
    btn.dataset.mode = info.asset ? 'auto' : 'manual';
    const note = $('updateNote');
    if (note && info.notes) {
      const brief = String(info.notes).split('\n').slice(0, 8).join('\n').trim();
      if (brief) note.textContent = `Nội dung cập nhật:\n${brief}`;
    }
    if (bar) bar.hidden = true;
  } else {
    const src = (info.sources || []).map((x) => x.name).join(' / ');
    const stale = info.stale ? ' (Bộ nhớ cache)' : '';
    st.textContent = `Đã là phiên bản mới nhất (v${info.current})${src ? ` · Nguồn: ${src}` : ''}${stale}`;
    showUpdateBtn(false);
    if (bar) bar.hidden = true;
  }
}

/** .btn 自带 display:inline-flex，会盖掉 hidden 属性，所以这里直接改 display */
function showUpdateBtn(on) {
  const btn = $('btnDoUpdate');
  if (!btn) return;
  btn.hidden = !on;
  btn.style.display = on ? '' : 'none';
}

function renderUpdateProgress(p) {
  if (!p) return;
  const st = $('updateState');
  const bar = $('updateBar');
  const fill = $('updateBarFill');
  if (p.stage === 'error') {
    if (st) st.textContent = `Cập nhật thất bại: ${p.message || ''}`;
    if (bar) bar.hidden = true;
    toast({ title: 'Cập nhật thất bại', body: p.message || '', type: 'error' });
    return;
  }
  if (st) st.textContent = p.message || 'Đang cập nhật…';
  if (bar && fill) {
    bar.hidden = false;
    fill.style.width = `${Math.max(0, Math.min(100, p.percent || 0))}%`;
  }
}

function bindUpdate() {
  const check = $('btnCheckUpdate');
  const go = $('btnDoUpdate');
  if (!check || !go) return;

  const runCheck = async (silent) => {
    if (!silent) {
      check.disabled = true;
      const old = check.textContent;
      check.textContent = 'Đang kiểm tra…';
      $('updateState').textContent = 'Đang kết nối đến GitHub…';
      try {
        const info = await api.updateCheck();
        renderUpdate(info);
        if (info && info.hasUpdate) toast({ title: `Phát hiện phiên bản mới ${info.tag}`, body: 'Bấm「Cập nhật ngay」để tải và cài đặt tự động', type: 'info' });
        else if (info && info.ok !== false) toast({ title: 'Đã là phiên bản mới nhất', body: `v${info.current}`, type: 'ok' });
      } catch (e) {
        $('updateState').textContent = `Kiểm tra thất bại: ${e.message}`;
      } finally {
        check.disabled = false;
        check.textContent = old;
      }
      return;
    }
    const info = await api.updateCheck().catch(() => null);
    if (info) renderUpdate(info);
  };

  check.addEventListener('click', () => runCheck(false));

  go.addEventListener('click', async () => {
    if (go.dataset.mode === 'manual') {
      api.updateOpenRelease(lastUpdate && lastUpdate.htmlUrl);
      return;
    }
    go.disabled = true;
    go.textContent = 'Đang cập nhật…';
    const r = await api.updateApply().catch((e) => ({ ok: false, error: e.message }));
    if (!r || !r.ok) {
      go.disabled = false;
      go.textContent = 'Cập nhật ngay';
      if (r && r.error && !r.manual) {
        $('updateState').textContent = `Cập nhật thất bại: ${r.error}`;
        toast({ title: 'Cập nhật thất bại', body: r.error, type: 'error' });
      }
    } else {
      $('updateState').textContent = `Đã tải xong v${r.version}, đang khởi động lại để hoàn tất…`;
    }
  });

  // 打开设置时如果还没结果，就顺手查一次（放后台，不打扰）
  runCheck(true).catch(() => {});
}

function bindSettings() {
  const save = async (patch) => {
    state.settings = await api.setSettings(patch);
  };

  if ($('btnPreflight')) $('btnPreflight').addEventListener('click', () => runPreflight());
  if ($('btnPreflightApply')) {
    $('btnPreflightApply').addEventListener('click', async () => {
      const btn = $('btnPreflightApply');
      btn.disabled = true;
      const r = await api.preflightApply().catch(() => null);
      btn.disabled = false;
      if (!r || !r.ok) {
        toast({ type: 'error', title: 'Áp dụng thất bại', body: (r && r.error) || 'Vui lòng thử lại sau' });
        return;
      }
      state.settings = r.settings;
      toast({
        type: 'ok',
        title: 'Đã cấu hình tối ưu cho máy tính này',
        body: `RAM: ${Math.round((r.recommended.memoryMB || 0) / 1024)} GB / CPU: ${r.recommended.cores} nhân / Màn hình: ${r.recommended.renderSize}`
          + (r.driverFile ? '; Đã tạo cấu hình điều khiển, sẽ áp dụng ở lần bật tới' : ''),
      });
      if (r.driverError) toast({ type: 'warn', title: 'Lưu trình điều khiển thất bại', body: r.driverError });
      fillSettings(r.settings);
      refreshStatus();
    });
  }
  if ($('btnDrvReload')) $('btnDrvReload').addEventListener('click', () => refreshDrivers());
  if ($('btnDrvFolder')) {
    $('btnDrvFolder').addEventListener('click', async () => {
      const r = await api.driversOpenFolder().catch(() => null);
      if (!r || !r.ok) toast({ type: 'error', title: 'Không mở được thư mục trình điều khiển' });
    });
  }
  if ($('btnDrvImport')) {
    $('btnDrvImport').addEventListener('click', async () => {
      const r = await api.driversImport().catch(() => null);
      if (!r || r.canceled) return;
      if (!r.ok) {
        toast({ type: 'error', title: 'Nhập thất bại', body: (r.errors || []).slice(0, 3).join('; ') });
        return;
      }
      toast({ type: 'ok', title: 'Trình điều khiển đã nhập và kích hoạt', body: `${r.driver.name} v${r.driver.version}` });
      if (r.overview) renderDrivers(r.overview);
    });
  }
  if ($('btnDrvExport')) {
    $('btnDrvExport').addEventListener('click', async () => {
      const r = await api.driversExportTemplate().catch(() => null);
      if (!r || r.canceled) return;
      if (!r.ok) { toast({ type: 'error', title: 'Xuất mẫu thất bại' }); return; }
      toast({ type: 'ok', title: 'Đã xuất mẫu cấu hình', body: 'Sau khi chỉnh sửa xong, lưu vào thư mục rồi bấm Làm mới' });
      refreshDrivers();
    });
  }

  $('setAdbPath').addEventListener('change', (e) => save({ adbPath: e.target.value.trim() }));
  $('setSystemImage').addEventListener('change', (e) => save({ runtime: { isoPath: e.target.value.trim() } }));
  // 内存 / 核心：填了具体值就关掉「自动」，填 0 又回到自动。
  // 旧代码只写 memoryMB，而 overridesFromSettings 只在 autoMemory=false 时才认它，
  // 于是「手动填了内存」一直被忽略 —— 这是设置页最容易被当成“没用”的一项。
  $('setMemory').addEventListener('change', (e) => {
    const v = Number(e.target.value) || 0;
    save(v > 0 ? { engine: { memoryMB: v, autoMemory: false } } : { engine: { memoryMB: 0, autoMemory: true } });
  });
  $('setCores').addEventListener('change', (e) => {
    const v = Number(e.target.value) || 0;
    save(v > 0 ? { engine: { cores: v, autoMemory: false } } : { engine: { cores: 0, autoMemory: true } });
  });
  if ($('setResourceMode')) {
    $('setResourceMode').addEventListener('change', async (e) => {
      // 资源策略会连带改 liteMode / priorityMode / renderSize（主进程里翻译）
      state.settings = await api.setSettings({ engine: { resourceMode: e.target.value } });
      fillSettings(state.settings);
      toast({ title: 'Đã thay đổi chính sách tài nguyên', body: 'Có hiệu lực ở lần mở ứng dụng tiếp theo', type: 'ok' });
    });
  }
  if ($('setRenderSize')) {
    $('setRenderSize').addEventListener('change', (e) => save({ engine: { renderSize: e.target.value } }));
  }
  if ($('setFastDns')) {
    $('setFastDns').addEventListener('change', (e) => save({ engine: { fastDns: e.target.checked } }));
  }
  if ($('setLocale')) {
    $('setLocale').addEventListener('change', async (e) => {
      state.settings = await api.setSettings({ engine: { locale: e.target.value } });
      toast({ title: 'Đã cập nhật ngôn ngữ hệ thống', body: 'Có hiệu lực sau khi khởi động lại môi trường Android', type: 'ok' });
    });
  }
  if ($('setChineseIme')) {
    $('setChineseIme').addEventListener('change', async (e) => {
      state.settings = await api.setSettings({ engine: { chineseIme: e.target.checked } });
      toast({
        title: e.target.checked ? 'Đã bật bộ gõ tiếng Trung' : 'Đã tắt bộ gõ tiếng Trung',
        body: 'Có hiệu lực sau khi khởi động lại môi trường',
        type: 'ok',
      });
    });
  }
  if ($('setKeepSnapshot')) {
    $('setKeepSnapshot').addEventListener('change', (e) => save({ engine: { keepSnapshot: e.target.checked } }));
  }
  if ($('setDataGB')) {
    $('setDataGB').addEventListener('change', (e) => {
      save({ engine: { dataPartitionGB: Number(e.target.value) || 0 } });
      refreshDataInfo();
    });
  }
  if ($('btnGrowData')) {
    $('btnGrowData').addEventListener('click', async () => {
      const gb = Number($('setDataGB').value) || 0;
      if (!gb) { toast({ title: 'Vui lòng chọn dung lượng', body: '「Tự động」nghĩa là phần mềm tự quyết định theo dung lượng đĩa trống', type: 'info' }); return; }
      const { response } = await api.confirm({
        title: 'Mở rộng phân vùng dữ liệu Android ngay?',
        message: `Phân vùng /data sẽ được tăng lên ${gb} GB (mở rộng tại chỗ, ứng dụng và dữ liệu được bảo toàn).`, 
        detail: 'Quá trình mở rộng cần đóng các ứng dụng Android đang chạy, sau đó khởi động lại mất khoảng mười mấy giây.',
        okLabel: 'Bắt đầu mở rộng',
      });
      if (response !== 1) return;
      $('btnGrowData').disabled = true;
      const old = $('btnGrowData').textContent;
      $('btnGrowData').textContent = 'Đang mở rộng…';
      const r = await api.setDataSize(gb).catch((e) => ({ ok: false, error: e.message }));
      $('btnGrowData').disabled = false;
      $('btnGrowData').textContent = old;
      if (r && !r.ok && r.needsReset) {
        // 快速启动的差量盘挡着：就地扩容做不到，只能按新容量重建 /data。
        // 这是明确的数据丢失操作，必须单独再确认一次。
        const again = await api.confirm({
          title: 'Cần đặt lại dữ liệu Android để mở rộng',
          message: `Android đang dùng Quickboot nên không thể mở rộng tại chỗ. Cần tạo lại /data để đạt dung lượng ${gb} GB.`, 
          detail: 'Quá trình này sẽ xóa các ứng dụng đã cài đặt (trình giả lập và ảnh hệ thống không bị ảnh hưởng). Bạn có muốn tiếp tục?',
          okLabel: 'Xóa và tạo lại',
        });
        if (again.response !== 1) { refreshDataInfo(); return; }
        $('btnGrowData').disabled = true;
        $('btnGrowData').textContent = 'Đang tạo lại…';
        const rr = await api.resetAndResize(gb).catch((e) => ({ ok: false, error: e.message }));
        $('btnGrowData').disabled = false;
        $('btnGrowData').textContent = old;
        toast({
          type: rr && rr.ok ? 'ok' : 'error',
          title: rr && rr.ok ? 'Đã tạo lại với dung lượng mới' : 'Tạo lại thất bại',
          body: rr && rr.ok
            ? `Lần mở ứng dụng tiếp theo sẽ tạo lại /data với dung lượng ${gb} GB` : (rr && rr.error) || 'Lỗi không xác định',
        });
        refreshDataInfo();
        return;
      }
      toast({
        type: r && r.ok ? 'ok' : 'error',
        title: r && r.ok ? 'Phân vùng dữ liệu đã mở rộng' : 'Mở rộng thất bại',
        body: r && r.ok ? `Hiện có khoảng ${r.fsGB || r.imageGB || gb} GB khả dụng` : (r && r.error) || 'Lỗi không xác định',
      });
      refreshDataInfo();
    });
  }
  $('setIdle').addEventListener('change', (e) => save({ engine: { idleShutdownMinutes: Number(e.target.value) || 0 } }));
  if ($('setSourcePref')) {
    $('setSourcePref').addEventListener('change', (e) => save({ runtime: { sourcePreference: e.target.value } }));
  }
  if ($('setAutoMirror')) {
    $('setAutoMirror').addEventListener('change', (e) => save({ runtime: { autoMirror: e.target.checked } }));
  }
  if ($('setGiteeToken')) {
    $('setGiteeToken').addEventListener('change', (e) => save({ runtime: { giteeToken: e.target.value.trim() } }));
  }
  if ($('setMirrorPrefix')) {
    $('setMirrorPrefix').addEventListener('change', (e) => save({ runtime: { mirrorPrefix: e.target.value.trim() } }));
  }
  if ($('setConnections')) {
    $('setConnections').addEventListener('change', (e) => {
      const n = Math.max(1, Math.min(16, Number(e.target.value) || 8));
      e.target.value = n;
      save({ runtime: { downloadConnections: n } });
    });
  }
  $('setAudio').addEventListener('change', (e) => save({ engine: { audio: e.target.checked } }));
  $('setLiteMode').addEventListener('change', (e) => save({ engine: { liteMode: e.target.checked } }));
  $('setPrewarm').addEventListener('change', (e) => save({ engine: { prewarm: e.target.checked } }));
  $('setPriorityMode').addEventListener('change', (e) => save({ engine: { priorityMode: e.target.value } }));
  const savePointer = async (patch) => {
    await save({ engine: patch });
    // 立刻按当前窗口焦点重装/卸载钩子，不用等下次切窗口
    api.refreshPointerMapping().catch(() => {});
  };
  $('setMouseRightBack').addEventListener('change', (e) => savePointer({ mouseRightBack: e.target.checked }));
  $('setMouseWheelMode').addEventListener('change', (e) => savePointer({ mouseWheelMode: e.target.value }));
  $('setMouseSideButtons').addEventListener('change', (e) => savePointer({ mouseSideButtons: e.target.checked }));
  if ($('setKeymapEnabled')) {
    $('setKeymapEnabled').addEventListener('change', async (e) => {
      await api.keymap.setEnabled(e.target.checked);
      toast({ title: e.target.checked ? 'Đã bật gán phím' : 'Đã tắt gán phím', type: 'ok' });
    });
  }
  $('setDeepTrim').addEventListener('change', async (e) => {
    await save({ engine: { deepTrim: e.target.checked } });
    // 关掉深度裁剪必须把之前 pm disable-user 的包恢复回来，否则影响是持久的
    if (!e.target.checked) {
      api.restoreSystemApps().catch(() => {});
      toast({ title: 'Đã khôi phục thành phần hệ thống', body: 'Đã tắt chế độ rút gọn sâu, các gói nền đang được khôi phục', type: 'info' });
    }
  });
  $('setCompat').addEventListener('change', async (e) => {
    const on = e.target.checked;
    await save({ runtime: { compatImage: on } });
    const env = ((state.status = await api.runtimeStatus()).env) || {};
    const ok = env.playImage && env.playImage.ok;
    $('compatInstallField').hidden = !on || !!ok;
    if (on && !ok) toast({ title: 'Đã bật chế độ tương thích ARM', body: 'Cần tải thêm Ảnh hệ thống tương thích Google Play (Android 14, ~1.5GB), bấm nút bên dưới để bắt đầu', type: 'info' });
    else if (on) toast({ title: 'Đã bật chế độ tương thích ARM', body: 'Khởi động lại môi trường để có hiệu lực', type: 'info' });
  });
  $('setAutoShortcut').addEventListener('change', (e) => save({ createShortcutOnInstall: e.target.checked }));
  $('setStartMenuShortcut').addEventListener('change', (e) => save({ createStartMenuShortcut: e.target.checked }));
  $('setShortcutDir').addEventListener('change', (e) => save({ shortcutDir: e.target.value.trim() }));
  $('setDeviceSharedDir').addEventListener('change', (e) => save({ deviceSharedDir: e.target.value.trim() }));
  $('setAutoStart').addEventListener('change', (e) => save({ autoStart: e.target.checked }));
  $('setDisplayMode').addEventListener('change', async (e) => {
    const mode = e.target.value;
    $('portraitField').hidden = mode === 'fullscreen';
    state.settings = await api.setSettings({ display: { mode } });
    toast({ title: mode === 'fullscreen' ? 'Đã chuyển toàn màn hình' : 'Đã chuyển cửa sổ dọc', type: 'ok' });
  });
  if ($('setAutoFullscreen')) {
    $('setAutoFullscreen').addEventListener('change', async (e) => {
      const on = e.target.value === 'on';
      state.settings = await api.setSettings({ display: { autoFullscreenOnLaunch: on } });
      toast({ title: on ? 'Đã bật tự động toàn màn hình' : 'Đã tắt tự động toàn màn hình', body: 'Có hiệu lực ở lần mở ứng dụng tiếp theo', type: 'ok' });
    });
  }
  if ($('setOrientationMode')) {
    $('setOrientationMode').addEventListener('change', async (e) => {
      const mode = e.target.value;
      state.settings = await api.setSettings({ display: { orientationMode: mode } });
      toast({
        title: mode === 'auto' ? 'Đã đặt theo ứng dụng' : (mode === 'landscape' ? 'Cố định ngang' : 'Cố định dọc'),
        body: mode === 'auto'
          ? 'Lần mở ứng dụng tiếp theo sẽ chọn hướng bảng theo ứng dụng, nếu khác hướng sẽ khởi động lại môi trường.'
          : 'Lần mở ứng dụng tiếp theo sẽ khởi động lại môi trường để đổi hướng, sau đó không cần khởi động lại nữa.',
        type: 'ok',
      });
    });
  }
  if ($('setTabletMode')) {
    $('setTabletMode').addEventListener('change', async (e) => {
      const on = e.target.value === 'on';
      state.settings = await api.setSettings({ display: { tabletMode: on } });
      toast({
        title: on ? 'Đã bật bố cục máy tính bảng' : 'Đã tắt bố cục máy tính bảng',
        body: 'Có hiệu lực ở lần mở ứng dụng tiếp theo (sẽ khởi động lại để đổi DPI).',
        type: 'ok',
      });
    });
  }
  if ($('setLandscape')) {
    $('setLandscape').addEventListener('change', async (e) => {
      const landscape = e.target.value === 'landscape';
      state.settings = await api.setSettings({ display: { landscape } });
      toast({
        title: landscape ? 'Đã chuyển bảng sang hướng ngang' : 'Đã chuyển bảng sang hướng dọc',
        body: 'Lần mở app tới sẽ khởi động lại môi trường để chuyển hướng (~mười mấy giây), sau đó sẽ không cần khởi động lại nữa.',
        type: 'ok',
      });
    });
  }
  $('setPortrait').addEventListener('change', async (e) => {
    state.settings = await api.setSettings({ display: { portrait: e.target.value } });
    toast({ title: 'Đã cập nhật kích thước hiển thị', body: 'Có hiệu lực ở lần mở ứng dụng tiếp theo', type: 'ok' });
  });
  $('setWindowEmbed').addEventListener('change', async (e) => {
    const embed = e.target.value === 'embed';
    state.settings = await api.setSettings({ display: { windowEmbed: embed } });
    toast({
      title: embed ? 'Đã chuyển về chế độ nhúng' : 'Đã chuyển sang chế độ cửa sổ độc lập',
      body: 'Có hiệu lực ở lần mở ứng dụng tiếp theo. Cửa sổ độc lập sẽ tự quản lý kích thước và xoay.',
      type: 'ok',
    });
  });
  $('btnRebuildShortcuts').addEventListener('click', async () => {
    const r = await api.rebuildShortcuts();
    toast({
      title: r && r.fixed && r.fixed.length ? 'Đã bổ sung lối tắt Desktop' : 'Lối tắt Desktop đã đầy đủ',
      body: r && r.fixed && r.fixed.length ? r.fixed.join(', ') : 'Lối tắt Desktop và Start Menu hoạt động bình thường',
      type: 'ok',
    });
  });

  $('btnDiagnostics').addEventListener('click', async () => {
    try {
      const r = await api.doctorReport();
      toast({ title: 'Đã xuất báo cáo chẩn đoán', body: `${r.diagnosis.title} · ${r.file}`, type: 'ok', sticky: true });
    } catch (e) {
      toast({ title: 'Xuất báo cáo thất bại', body: e.message, type: 'error' });
    }
  });

  $('btnCleanup').addEventListener('click', async () => {
    const btn = $('btnCleanup');
    const includeSnapshots = $('chkCleanSnapshots') && $('chkCleanSnapshots').checked;
    btn.disabled = true;
    try {
      const preview = await api.runtimeCleanup({ apply: false, includeSnapshots });
      if (!preview.candidates.length) {
        toast({ title: 'Hệ thống đã tinh gọn', body: 'Không có ảnh hệ thống cũ hoặc snapshot cần dọn dẹp.', type: 'ok' });
        return;
      }
      const r = await api.runtimeCleanup({ apply: true, includeSnapshots });
      if (r.cancelled) return;
      toast({
        title: 'Dọn dẹp hoàn tất',
        body: `Đã giải phóng khoảng ${(r.saved / 1048576).toFixed(0)} MB (${r.removed.length} mục), ứng dụng đã cài đặt được giữ nguyên.`, 
        type: 'ok',
      });
      const u = await api.runtimeUsage();
      $('usageText').textContent = `Tổng: ${u.totalText} · Có thể dọn dẹp: ${u.reclaimableText} (${u.count} mục)`;
    } catch (e) {
      toast({ title: 'Dọn dẹp thất bại', body: e.message, type: 'error' });
    } finally {
      btn.disabled = false;
    }
  });

  // 重置安卓数据：二级确认（先确认意图，再确认不可撤销），清完刷新占用统计
  $('btnResetData').addEventListener('click', async () => {
    const btn = $('btnResetData');
    btn.disabled = true;
    try {
      const first = await api.confirm({
        type: 'warning',
        title: 'Đặt lại toàn bộ dữ liệu Android?',
        message: 'Thao tác này sẽ đưa Android về trạng thái sạch ban đầu lúc mới cài đặt:',
        detail: '• Xóa toàn bộ ứng dụng bên thứ ba đã cài đặt cùng dữ liệu và phiên đăng nhập\n'
          + '• Xóa snapshot Quickboot hiện tại\n'
          + '• Ảnh hệ thống không bị ảnh hưởng, lần sau mở app sẽ tự động tạo dữ liệu mới\n\n'
          + 'Thao tác này không thể hoàn tác. Bạn có muốn tiếp tục?',
        buttons: ['Hủy', 'Tiếp tục'],
        defaultId: 0,
        cancelId: 0,
      });
      if (!first || first.response !== 1) return;
      const second = await api.confirm({
        type: 'warning',
        title: 'Xác nhận lại một lần nữa',
        message: 'Các ứng dụng đã cài và toàn bộ dữ liệu sẽ bị xóa vĩnh viễn, bạn có chắc chắn không?',
        detail: 'Lưu ý: Ảnh hệ thống Android, các tệp APK và icon gốc trên máy tính sẽ không bị ảnh hưởng.',
        buttons: ['Hủy', 'Xác nhận đặt lại'],
        defaultId: 0,
        cancelId: 0,
      });
      if (!second || second.response !== 1) return;
      const r = await api.runtimeResetData();
      if (!r || !r.ok) {
        toast({ title: 'Đặt lại thất bại', body: (r && r.error) || 'Vui lòng thử lại', type: 'error' });
        return;
      }
      toast({
        title: 'Dữ liệu Android đã được đặt lại',
        body: `Giải phóng khoảng ${r.reclaimedMB} MB, danh sách ứng dụng đã được làm sạch.`, 
        type: 'ok',
      });
      const u = await api.runtimeUsage();
      $('usageText').textContent = `Tổng: ${u.totalText} · Có thể dọn dẹp: ${u.reclaimableText} (${u.count} mục)`;
    } catch (e) {
      toast({ title: 'Đặt lại thất bại', body: e.message, type: 'error' });
    } finally {
      btn.disabled = false;
    }
  });

  // 修复网络：安卓里联网页面一直黑屏（红果点「同意并继续」后整屏黑）时用。
  // 根因是虚拟机 /data 里的 Wi-Fi 配置坏了，wlan0 没起来、没有默认路由。
  // Play Store 镜像不允许 root，只能整体重置 /data；应用清单保留，点开时会自动重装。
  $('btnRepairNetwork').addEventListener('click', async () => {
    const btn = $('btnRepairNetwork');
    btn.disabled = true;
    try {
      const ok = await api.confirm({
        type: 'warning',
        title: 'Khắc phục mạng máy ảo?',
        message: 'Trang cần kết nối mạng trong ứng dụng bị quay vòng hoặc màn hình đen thường là do máy ảo Android chưa có mạng.',
        detail: 'Quá trình khắc phục sẽ thử lần lượt:\n\n1. Khởi động nguội máy ảo (không tải snapshot) —— Không ảnh hưởng dữ liệu\n2. Nếu vẫn không được sẽ đặt lại dữ liệu Android —— Danh sách ứng dụng được giữ nguyên, khi mở sẽ tự cài lại (mất dữ liệu đăng nhập)\n\nQuá trình mất khoảng 1-5 phút. Tiếp tục?',
        buttons: ['Hủy', 'Bắt đầu khắc phục'],
        defaultId: 0,
        cancelId: 0,
      });
      if (!ok || ok.response !== 1) return;
      const r = await api.runtimeRepairNetwork();
      if (!r || !r.ok) {
        toast({
          title: 'Mạng vẫn chưa được khôi phục',
          body: (r && r.error) || 'Máy ảo vẫn chưa có mạng, vui lòng kiểm tra kết nối mạng hoặc tường lửa của máy tính.',
          type: 'error',
        });
        return;
      }
      toast({
        title: 'Mạng đã được khôi phục',
        body: `${(r.network && r.network.ip) || 'Đã có mạng'}${r.wiped ? ' (Đã đặt lại dữ liệu Android để sửa mạng, mở ứng dụng sẽ tự cài lại)' : ' (Giữ nguyên dữ liệu của bạn)'}`,
        type: 'ok',
      });
    } catch (e) {
      toast({ title: 'Khắc phục thất bại', body: e.message, type: 'error' });
    } finally {
      btn.disabled = false;
    }
  });

  // 清理旧版本残留：扫描旧程序目录 / 失效卸载项 / 更新临时文件，确认后一次性清掉。
  $('btnLeftovers').addEventListener('click', async () => {
    const btn = $('btnLeftovers');
    btn.disabled = true;
    try {
      const r = await api.leftoversScan();
      if (!r || !r.ok) {
        toast({ title: 'Quét thất bại', body: (r && r.error) || 'Vui lòng thử lại', type: 'error' });
        return;
      }
      const items = r.items || [];
      if (!items.length) {
        toast({ title: 'Hệ thống rất sạch', body: 'Không phát hiện tệp rác của phiên bản cũ.', type: 'ok' });
        return;
      }
      const mb = Math.round((r.totalBytes || 0) / 1048576);
      const lines = items.slice(0, 8).map((x) => `• ${x.note}：${x.path}`);
      if (items.length > 8) lines.push(`…còn lại ${items.length - 8} mục`);
      const ok = await api.confirm({
        type: 'warning',
        title: 'Dọn dẹp tệp còn sót của phiên bản cũ?',
        message: `Tìm thấy ${items.length} tệp thừa, khoảng ${mb} MB:`, 
        detail: `${lines.join('\n')}\n\nChỉ xóa thư mục phiên bản cũ, mục gỡ cài đặt hỏng và tệp cập nhật tạm thời.`
          + 'Phiên bản đang chạy và dữ liệu ứng dụng hoàn toàn không bị ảnh hưởng.',
        buttons: ['Hủy', 'Bắt đầu dọn dẹp'],
        defaultId: 1,
        cancelId: 0,
      });
      if (!ok || ok.response !== 1) return;
      const c = await api.leftoversClean(items);
      if (!c || !c.ok) {
        toast({ title: 'Dọn dẹp thất bại', body: (c && c.error) || 'Vui lòng thử lại', type: 'error' });
        return;
      }
      const failNote = (c.failed && c.failed.length) ? `, ${c.failed.length} mục đang bị khóa chưa xóa` : '';
      toast({
        title: 'Đã dọn dẹp tệp thừa phiên bản cũ',
        body: `Đã xóa ${c.removed.length} mục, giải phóng ${c.freedMB || 0} MB${failNote}.`, 
        type: 'ok',
      });
      const u = await api.runtimeUsage();
      $('usageText').textContent = `Tổng: ${u.totalText} · Có thể dọn dẹp: ${u.reclaimableText} (${u.count} mục)`;
    } catch (e) {
      toast({ title: 'Dọn dẹp thất bại', body: e.message, type: 'error' });
    } finally {
      btn.disabled = false;
    }
  });

  $('btnOpenShared').addEventListener('click', () => api.openSharedDir());

  // 重建快捷方式：桌面图标被误删 / 被安全软件拦掉时的兜底入口
  $('btnRebuildShortcuts').addEventListener('click', async () => {
    const btn = $('btnRebuildShortcuts');
    btn.disabled = true;
    try {
      const r = await api.rebuildShortcuts().catch(() => ({ ok: false }));
      const fixed = (r && r.fixed) || [];
      toast(fixed.length
        ? { title: 'Đã tạo lại lối tắt', body: fixed.join('、'), type: 'ok' }
        : { title: 'Lối tắt đã đầy đủ', body: 'Không có lối tắt nào cần tạo lại', type: 'info' });
    } finally {
      btn.disabled = false;
    }
  });

  // 共享目录：先浏览选目录，再「保存并迁移」把旧文件一次性搬到新目录
  $('btnBrowseShared').addEventListener('click', async () => {
    const picked = await api.openDir();
    if (!picked) return;
    $('setSharedDir').value = picked;
    toast({ title: 'Đã chọn thư mục mới', body: 'Bấm「Lưu & Di chuyển」để chuyển tệp cũ sang', type: 'info' });
  });
  $('btnSaveShared').addEventListener('click', async () => {
    const dir = $('setSharedDir').value.trim();
    if (!dir) { toast({ title: 'Vui lòng nhập hoặc chọn thư mục trước', type: 'error' }); return; }
    const btn = $('btnSaveShared');
    btn.disabled = true;
    const r = await api.setSharedDir(dir).catch(() => ({ ok: false }));
    btn.disabled = false;
    if (r.ok) {
      const moved = r.oldDir && r.oldDir !== r.newDir;
      toast({ title: 'Đã cập nhật thư mục chia sẻ', body: moved ? 'Các tệp cũ đã được chuyển sang thư mục mới' : 'Đã lưu', type: 'ok' });
    } else {
      toast({ title: 'Lưu thất bại', body: r.error, type: 'error' });
    }
  });

  // 一键卸载 ApkStart 本体（取消 .apk 关联 + 启动卸载程序；便携版手动删除）
  $('btnUninstall').addEventListener('click', async () => {
    const ok = window.confirm('Bạn có chắc chắn muốn gỡ cài đặt ApkStart?\n\nThao tác này sẽ hủy liên kết file .apk và gỡ bỏ phần mềm. Không thể hoàn tác.');
    if (!ok) return;
    const btn = $('btnUninstall');
    btn.disabled = true;
    const r = await api.removeSelf().catch(() => ({ ok: false }));
    if (r.ok && r.portable) {
      btn.disabled = false;
      toast({
        title: 'Bản Portable không thể tự gỡ cài đặt',
        body: `Vui lòng xóa thư mục ứng dụng (${r.exeDir}) và thư mục dữ liệu (${r.dataDir}) thủ công`, 
        type: 'info', sticky: true,
      });
      return;
    }
    if (!r.ok) {
      btn.disabled = false;
      toast({ title: 'Gỡ cài đặt thất bại', body: r.error, type: 'error' });
      return;
    }
    toast({ title: 'Đang gỡ cài đặt…', body: 'Trình gỡ cài đặt đã khởi chạy, ApkStart sẽ thoát ngay sau đây', type: 'ok', sticky: true });
  });

  // ARM 兼容镜像下载（带进度 toast）
  $('btnInstallPlay').addEventListener('click', async () => {
    const btn = $('btnInstallPlay');
    btn.disabled = true;
    const t = toast({ title: 'Bắt đầu tải ảnh hệ thống tương thích ARM', body: 'Đang chuẩn bị…', sticky: true, spinner: true, progress: 3 });
    const un = api.on('provision:progress', (p) => {
      if (p.component !== 'playimg') return;
      t.update({ title: 'Tải ảnh hệ thống tương thích ARM', body: p.message || '', progress: p.percent });
    });
    try {
      const r = await api.installPlayImage();
      if (r && r.ok) {
        t.update({ title: 'Ảnh tương thích ARM đã sẵn sàng', body: 'Khởi động lại môi trường để có hiệu lực', progress: 100 });
        setTimeout(() => t.dismiss(), 3000);
        $('compatInstallField').hidden = true;
        refreshStatus();
      } else {
        t.update({ title: 'Tải ảnh tương thích thất bại', body: (r && r.error) || 'Lỗi không xác định', progress: null });
        t.dismiss();
        toast({ title: 'Tải ảnh tương thích thất bại', body: (r && r.error) || 'Lỗi không xác định', type: 'error' });
      }
    } catch (e) {
      t.dismiss();
      toast({ title: 'Tải ảnh tương thích thất bại', body: e.message, type: 'error' });
    } finally {
      un();
      btn.disabled = false;
    }
  });

  // 兼容镜像状态显示
  (async () => {
    const env = ((state.status = await api.runtimeStatus()).env) || {};
    const s = state.settings;
    const on = !!(s && s.runtime && s.runtime.compatImage);
    const ok = env.playImage && env.playImage.ok;
    $('compatInstallField').hidden = !on || !!ok;
    if (env.playImage) {
      $('compatImgStatus').textContent = ok
        ? `Đã sẵn sàng (${(env.playImage.size / 1073741824).toFixed(2)} GB)` : 'Chưa tải';
    }
  })();
  $('btnOpenData').addEventListener('click', async () => {
    const info = await api.info();
    const dir = info.runtimeDir || info.dataDir;
    window.open(`file:///${dir.replace(/\\/g, '/')}`);
  });
  $('btnBrowseRuntimeDir').addEventListener('click', async () => {
    const info = await api.info();
    const picked = await api.openDir();
    if (!picked) return;
    await api.setSettings({ runtime: { dir: picked } });
    $('setRuntimeDir').value = picked;
    toast({ title: 'Đã cập nhật thư mục dữ liệu', body: 'Vui lòng khởi động lại ApkStart để có hiệu lực', type: 'ok', sticky: true });
  });

  // 安卓数据目录（AVD + 快照）：真正吃盘的那块，单独指到别的盘
  if ($('btnBrowseAvdDir')) {
    $('btnBrowseAvdDir').addEventListener('click', async () => {
      const picked = await api.openDir();
      if (!picked) return;
      await api.setSettings({ runtime: { avdDir: picked } });
      $('setAvdDir').value = picked;
      toast({
        title: 'Đã cập nhật thư mục dữ liệu Android',
        body: 'Vui lòng khởi động lại ApkStart để có hiệu lực. Thư mục apkstart.avd ở vị trí cũ có thể chuyển sang vị trí mới.',
        type: 'ok',
        sticky: true,
      });
    });
  }
  if ($('btnOpenAvdDir')) {
    $('btnOpenAvdDir').addEventListener('click', async () => {
      const info = await api.dataInfo().catch(() => null);
      const dir = (info && info.avdDir) || (await api.info()).dataDir;
      window.open(`file:///${String(dir).replace(/\\/g, '/')}`);
    });
  }

  $('btnRuntimeStart').addEventListener('click', async () => {
    const el = $('probeResult');
    el.textContent = 'Đang khởi động…';
    const r = await api.runtimeStart();
    el.textContent = r.ok ? `Đã sẵn sàng: ${r.engine}` : `Khởi động thất bại: ${r.error}`;
    refreshStatus();
  });

  $('btnRuntimeStop').addEventListener('click', async () => {
    await api.runtimeStop();
    $('probeResult').textContent = 'Đã dừng máy ảo tích hợp';
    refreshStatus();
  });

  $('btnAssoc').addEventListener('click', async () => {
    const btn = $('btnAssoc');
    if (btn.dataset.on === '1') {
      await api.assocUnregister();
      btn.textContent = 'Chưa liên kết · Nhấp để bật';
      btn.dataset.on = '0';
      toast({ title: 'Đã hủy liên kết định dạng .apk' });
    } else {
      const r = await api.assocRegister();
      btn.textContent = 'Đã liên kết · Nhấp để hủy';
      btn.dataset.on = '1';
      toast({ title: 'Đã bật liên kết định dạng .apk', body: r.ok ? 'Bây giờ nhấp đúp file APK sẽ tự động cài vào ApkStart' : '', type: r.ok ? 'ok' : 'error' });
    }
  });
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
  // 链接统一走系统浏览器
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="http"]');
    if (!a) return;
    e.preventDefault();
    api.openExternal(a.getAttribute('href'));
  });

  $('btnSettings').addEventListener('click', openSettings);
  // 状态标签也当入口：点「需要部署 / 引导中 / Android 14」直接进设置的运行时面板
  $('engineTag').addEventListener('click', () => showSetup(true));
  $('btnCloseSettings').addEventListener('click', closeSettings);
  $('btnDoneSettings').addEventListener('click', closeSettings);
  $('settingsMask').addEventListener('click', (e) => {
    if (e.target === $('settingsMask')) closeSettings();
  });

  // 运行时部署：入口已收进设置，这里只处理面板内的按钮
  $('btnDeployAll').addEventListener('click', deployAll);
  $('btnMarkInstalled').addEventListener('click', markInstalled);
  $('btnGuideClose').addEventListener('click', () => { $('setupGuide').hidden = true; });
  $('btnSetupAdvanced').addEventListener('click', () => {
    const adv = document.querySelector('.advanced-group');
    if (adv) {
      adv.open = true;
      adv.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  });

  // 状态条上的自检计数：点开就是设置里的运行时面板
  $('envChip').addEventListener('click', () => {
    openSettings().then(() => {
      const box = $('envCheck');
      if (box && !box.hidden) box.scrollIntoView({ block: 'center', behavior: 'smooth' });
      else $('runtimeGroup').scrollIntoView({ block: 'start', behavior: 'smooth' });
    }).catch(() => {});
  });

  $('setupSteps').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === 'emulator' || act === 'sysimg' || act === 'accel'
      || act === 'adb' || act === 'qemu' || act === 'iso' || act === 'disk') {
      const r = await runStep(act);
      if (!r.ok) toast({ title: 'Thao tác thất bại', body: r.error, type: 'error', sticky: true });
      return;
    }
    if (act === 'isoImport') {
      const r = await api.importIso();
      if (r.ok) { toast({ title: 'Đã nhập ảnh hệ thống', body: r.path, type: 'ok' }); refreshStatus(); }
      else if (!r.canceled) toast({ title: 'Nhập thất bại', body: r.error, type: 'error' });
      return;
    }
    if (act === 'diskImport') {
      const r = await api.importDisk();
      if (r.ok) { toast({ title: 'Đã nhập đĩa ảo', body: 'Có thể khởi động môi trường ngay', type: 'ok' }); refreshStatus(); }
      else if (!r.canceled) toast({ title: 'Nhập thất bại', body: r.error, type: 'error' });
      return;
    }
    if (act === 'install') { await startInstall(); return; }
    if (act === 'vmStart') {
      const t = toast({ title: 'Đang khởi động môi trường…', body: 'Lần đầu khởi động cần tải hệ thống Android', sticky: true, spinner: true });
      const r = await api.runtimeStart();
      if (r.ok) { t.update({ title: 'Môi trường đã sẵn sàng', type: 'ok' }); setTimeout(t.dismiss, 2200); }
      else t.update({ title: 'Khởi động thất bại', body: r.error, type: 'error' });
      refreshStatus();
      return;
    }
    if (act === 'vmStop') {
      await api.runtimeStop();
      toast({ title: 'Phiên môi trường đã kết thúc' });
      refreshStatus();
    }
  });

  const pick = async () => {
    const files = await api.pickApk();
    if (files.length) installFiles(files);
  };
  $('btnInstall').addEventListener('click', pick);
  $('btnInstall2').addEventListener('click', pick);
  // 共享目录入口移到设置里：同步 + 打开都在「文件互通」组内
  const btnSync = $('btnSyncShared');
  if (btnSync) btnSync.addEventListener('click', async () => {
    btnSync.disabled = true;
    try {
      await api.syncShared();
      toast({ title: 'Đã đồng bộ thư mục chia sẻ', type: 'ok' });
    } catch (_) {
      toast({ title: 'Đồng bộ thất bại', body: 'Bỏ qua đồng bộ khi môi trường chưa sẵn sàng', type: 'error' });
    } finally {
      btnSync.disabled = false;
    }
  });

  $('search').addEventListener('input', (e) => {
    state.filter = e.target.value;
    renderGrid();
  });

  $('grid').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    // 「添加应用」卡片没有 data-pkg，走安装流程而不是启动。
    // 直接转调工具栏那个「安装 APK」按钮，复用它的文件选择逻辑。
    if (card.classList.contains('card-add')) { $('btnInstall').click(); return; }
    if (card.dataset.pkg) launchApp(card.dataset.pkg);
  });

  $('grid').addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    e.preventDefault();
    showMenu(e.clientX, e.clientY, card.dataset.pkg);
  });

  $('grid').addEventListener('dblclick', (e) => {
    const card = e.target.closest('.card');
    if (card) createShortcut(card.dataset.pkg);
  });

  $('ctxmenu').addEventListener('click', (e) => {
    const item = e.target.closest('.item');
    if (item) handleMenu(item.dataset.act);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#ctxmenu')) hideMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideMenu();
      closeSettings();
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      $('search').focus();
    }
  });

  // 拖放安装
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    $('dropzone').classList.add('on');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) $('dropzone').classList.remove('on');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('dropzone').classList.remove('on');
    const files = [...(e.dataTransfer?.files || [])];
    const paths = files
      .map((f) => { try { return api.pathForFile(f); } catch (_) { return null; } })
      .filter((p) => p && /\.(apk|xapk|apks)$/i.test(p));
    if (paths.length) installFiles(paths);
    else toast({ title: 'Vui lòng kéo vào tệp .apk, .xapk hoặc .apks', type: 'error' });
  });

  // 主进程事件
  api.on('install:error', (p) => {
    // 报错了就别再让「正在安装…」那条一直转圈（可能来自双击 APK 的另一条链路）
    if (installToast) { try { installToast.dismiss(); } catch (_) { /* ignore */ } installToast = null; }
    const name = p && p.file ? String(p.file).split(/[\\/]/).pop() : '';
    toast({
      title: name ? `Cài đặt thất bại: ${name}` : 'Cài đặt thất bại',
      body: friendlyInstallErrorText((p && p.message) || 'Lỗi không xác định'),
      type: 'error',
    });
  });
  api.on('toast', (p) => toast({ title: p.message, type: p.type === 'error' ? 'error' : 'info' }));
  api.on('app:launched', () => setTimeout(refreshApps, 800));
  // 应用被关掉（托盘「关闭当前应用」、右键菜单、或窗口被关）后要刷新「运行中」标记
  api.on('apps:changed', () => setTimeout(refreshApps, 300));
  api.on('runtime:log', (m) => console.log('[runtime]', m));
  api.on('ui:navigate', (v) => {
    if (v === 'settings') openSettings();
    if (v === 'setup') { showSetup(true); refreshStatus(); }
  });
  api.on('provision:progress', (p) => updateStepProgress(p.component, p));
  api.on('update:state', (info) => {
    if (!info) return;
    renderUpdate(info);
    // 启动 8 秒后才拿到更新信息：欢迎卡若还开着，把「发现新版本」这条补进去
    const wm = $('welcomeMask');
    if (wm && !wm.hidden) renderWelcomeTips();
  });
  api.on('update:progress', (p) => renderUpdateProgress(p));
}

/* ---------------- 启动 ---------------- */

async function init() {
  bindEvents();
  bindSettings();
  bindUpdate();
  bindAndroid();
  bindWelcome();
  state.settings = await api.getSettings();
  await refreshStatus();
  await refreshApps();
  refreshAndroid();
  selfCheck();
  maybeShowWelcome();
  setInterval(refreshStatus, 6000);
  setInterval(refreshApps, 15000);
  setInterval(selfCheck, 60000);
}

/* ---------------- 启动欢迎卡 ---------------- */

let startupInfo = null;

function greetingOf(h) {
  if (h < 5) return 'Khuya rồi';
  if (h < 11) return 'Chào buổi sáng';
  if (h < 13) return 'Chào buổi trưa';
  if (h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

function bindWelcome() {
  const mask = $('welcomeMask');
  if (!mask) return;
  const close = () => { mask.hidden = true; };
  const never = $('welcomeNever');
  $('welcomeOk').addEventListener('click', () => {
    if (never && never.checked) api.setSettings({ welcome: { disabled: true } }).catch(() => {});
    close();
  });
  $('welcomeSettings').addEventListener('click', () => { close(); openSettings(); });
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !mask.hidden) close(); });
}

/** 决定要不要弹：开机自启必弹；手动打开则每天最多一次，且用户可永久关闭 */
async function maybeShowWelcome() {
  const mask = $('welcomeMask');
  if (!mask) return;
  // 冒烟截图时不要弹欢迎卡：否则每次自动截图都被它挡住主界面
  try { if ((await api.startupInfo()).smoke) return; } catch (_) { /* ignore */ }
  try { startupInfo = await api.startupInfo(); } catch (_) { startupInfo = null; }
  const cfg = (state.settings && state.settings.welcome) || {};
  if (cfg.disabled) return;
  const today = new Date().toISOString().slice(0, 10);
  if (!(startupInfo && startupInfo.autostart) && cfg.lastDate === today) return;

  const h = new Date().getHours();
  $('welcomeHi').textContent = `${greetingOf(h)}, chào mừng bạn quay lại!`;
  const ver = (startupInfo && startupInfo.version) || (state.status && state.status.version) || '';
  const ready = state.status && state.status.ready;
  $('welcomeSub').textContent = `ApkStart${ver ? ` v${ver}` : ''} · ${ready ? 'Môi trường sẵn sàng, nhấp là mở' : 'Môi trường sẽ tự động chuẩn bị khi cần'}`;

  const apps = (state.apps || []).length;
  const dev = $('statusDevice') ? $('statusDevice').textContent.trim() : '';
  const chips = [
    { k: String(apps), v: 'Ứng dụng đã cài' },
    { k: ready ? 'Sẵn sàng' : 'Chờ lệnh', v: 'Môi trường Android' },
    { k: dev ? dev.replace(/^.*?(\d+)/, '$1') : '—', v: 'Thiết bị / Cổng' },
  ];
  $('welcomeStats').innerHTML = chips
    .map((c) => `<div class="welcome-stat"><b>${esc(c.k)}</b><span>${esc(c.v)}</span></div>`)
    .join('');

  const tips = [];
  $('welcomeTips').innerHTML = '';
  mask.hidden = false;
  renderWelcomeTips();
  api.setSettings({ welcome: { lastDate: today } }).catch(() => {});
}

/** 提示区单独渲染：启动 8 秒后才拿到更新信息，那时卡片可能还开着，需要补一次 */
function renderWelcomeTips() {
  const box = $('welcomeTips');
  if (!box) return;
  const apps = (state.apps || []).length;
  const tips = [];
  if (lastUpdate && lastUpdate.hasUpdate) {
    tips.push(`Đã có phiên bản mới <b>${esc(lastUpdate.tag || '')}</b>, có thể cập nhật trong「Cài đặt → Cập nhật」`);
  }
  if (!apps) {
    tips.push('Kéo thả tệp APK/XAPK vào cửa sổ là cài được ngay, xong sẽ tự tạo lối tắt Desktop');
  } else {
    tips.push('Nhấp đúp thẻ ứng dụng để chạy trong cửa sổ độc lập, góc trên phải có thể xoay / thu phóng / đóng');
  }
  tips.push('Đóng cửa sổ chỉ thoát ứng dụng đó, môi trường Android vẫn giữ để mở lần sau nhanh tức thì');
  box.innerHTML = tips
    .map((t, i) => `<div class="welcome-tip"><i>${i + 1}</i><span>${t}</span></div>`)
    .join('');
}

/* ---------------- 环境自检 ---------------- */

let envBusy = false;

/** 拉取 doctor:selfCheck：把问题渲染到设置里的自检面板，并在状态条上留一个计数 */
async function selfCheck() {
  if (envBusy) return;
  envBusy = true;
  try {
    const r = await api.selfCheck().catch(() => null);
    if (r) renderEnvCheck(r);
  } catch (_) { /* 自检失败不阻断主流程 */ }
  finally { envBusy = false; }
}

function renderEnvCheck(r) {
  const box = $('envCheck');
  if (!box) return;
  // 「组件缺失」在同一个面板的一键完成里已经覆盖，不再重复列出
  const needDeploy = !!(state.status && state.status.needsSetup);
  const issues = (r.issues || []).filter((i) => !(needDeploy && i.fix === 'deploy'));

  // 主界面不再放横幅：只在底部状态条上留一个可点的计数，点开就是设置里的自检面板
  const chip = $('envChip');
  if (chip) {
    const errs = issues.filter((i) => i.severity === 'error').length;
    chip.hidden = issues.length === 0;
    chip.textContent = errs ? `${errs} mục cần sửa` : `${issues.length} thông báo`;
    chip.className = `status-chip${errs ? ' err' : ''}`;
    chip.title = issues.map((i) => i.title).join('；');
  }

  if (!issues.length) {
    box.hidden = false;
    box.innerHTML = `
      <div class="env-check-ok">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>
        <span>Kiểm tra môi trường hoàn tất, không phát hiện sự cố nào.</span>
        <span style="flex:1"></span>
        <button class="btn ghost sm" id="btnEnvRecheck">Kiểm tra lại</button>
      </div>`;
    const re = $('btnEnvRecheck');
    if (re) re.addEventListener('click', selfCheck);
    return;
  }
  const errs = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.length - errs;
  box.hidden = false;
  box.innerHTML = `
    <div class="env-check-head">
      <span class="ec-title">Kiểm tra môi trường</span>
      ${errs ? `<span class="ec-count">${errs} lỗi nghiêm trọng</span>` : ''}
      ${warns ? `<span class="ec-count warn">${warns} cảnh báo</span>` : ''}
      <span class="ec-spacer"></span>
      <button class="btn ghost sm" id="btnEnvRecheck">Kiểm tra lại</button>
      <button class="btn primary sm" id="btnEnvFixAll">Sửa tất cả bằng 1 cú nhấp</button>
    </div>
    <div class="env-check-list">
      ${issues.map((i) => `
        <div class="env-check-item ${i.severity}">
          <span class="ec-sev"></span>
          <div class="ec-body">
            <div class="ec-name">${esc(i.title)}</div>
            <div class="ec-hint">${esc(i.hint || '')}</div>
          </div>
          ${i.fix ? `<button class="ec-fix" data-code="${esc(i.code)}">Sửa lỗi</button>` : ''}
        </div>`).join('')}
    </div>`;
  const re = $('btnEnvRecheck');
  if (re) re.addEventListener('click', selfCheck);
  const fixAll = $('btnEnvFixAll');
  if (fixAll) fixAll.addEventListener('click', () => fixAllIssues(issues));
  box.querySelectorAll('.ec-fix').forEach((b) => {
    b.addEventListener('click', () => {
      const issue = issues.find((x) => x.code === b.dataset.code);
      if (issue) fixIssue(issue);
    });
  });
}

async function fixIssue(issue) {
  switch (issue.fix) {
    case 'vcRedist': {
      const r = await api.installVcRedist().catch(() => ({ ok: false }));
      if (!r.ok && r.reason === 'no-installer') {
        api.openExternal('https://learn.microsoft.com/zh-CN/cpp/windows/latest-supported-vc-redist?view=msvc-170#visual-studio-2015-2017-2019-and-2022');
        toast({ title: 'Không tìm thấy gói cài tích hợp', body: 'Đã mở trang tải Microsoft chính thức, vui lòng tải bản x64', type: 'info' });
        break;
      }
      toast(r.ok
        ? { title: 'Gói runtime VC++ đã được cài đặt', type: 'ok' }
        : { title: 'Cài đặt chưa hoàn tất', body: r.error || 'Vui lòng thử lại', type: 'error' });
      break;
    }
    case 'virtualization': {
      const t = toast({ title: 'Đang bật tăng tốc phần cứng…', body: 'Vui lòng chọn Yes trong cửa sổ phân quyền Admin', sticky: true, spinner: true });
      const r = await api.enableVirtualization().catch(() => ({ ok: false }));
      if (r.ok) {
        t.update({ title: 'Tăng tốc phần cứng đã được kích hoạt', body: r.restartNeeded ? 'Vui lòng khởi động lại máy tính để đạt hiệu năng tốt nhất' : (r.note || ''), type: 'ok' });
        setTimeout(t.dismiss, 3200);
      } else if (r.manual) {
        // 商店（MSIX）版：包固定 mediumIL，通常拿不到管理员授权。
        // 与其让用户点一个注定失败的按钮，不如直接把「启用或关闭 Windows 功能」
        // 对话框弹出来，并告诉他勾哪一项。
        t.dismiss();
        await api.openWindowsFeatures?.().catch(() => null);
        toast({
          title: 'Cần bật thủ công một lần (chỉ duy nhất lần này)',
          body: r.note || 'Trong cửa sổ vừa mở, tích chọn「Nền tảng Trình giám sát ảo Windows」, bấm OK rồi khởi động lại máy tính.',
          type: 'info',
          sticky: true,
        });
      } else if (r.cancelled) {
        t.update({ title: 'Đã hủy', body: r.error || 'Chưa cấp quyền quản trị, chưa thay đổi cài đặt tăng tốc.', type: 'info', spinner: false });
        setTimeout(t.dismiss, 4200);
      } else {
        t.update({ title: 'Chưa thể kích hoạt', body: r.error || r.note || 'Vui lòng thử lại', type: 'error', sticky: true });
      }
      break;
    }
    case 'disk': {
      // 主进程会弹出原生确认框（含可释放空间预览），这里不再重复 confirm
      const r = await api.runtimeCleanup({ apply: true }).catch(() => null);
      if (!r) { toast({ title: 'Dọn dẹp thất bại', body: 'Vui lòng thử lại', type: 'error' }); break; }
      if (r.cancelled) break;
      toast({ title: 'Dọn dẹp hoàn tất', body: `Đã giải phóng khoảng ${((r.saved || 0) / 1048576).toFixed(0)} MB`, type: 'ok' });
      break;
    }
    case 'path': {
      toast({ title: 'Khuyên đổi sang thư mục tiếng Anh', body: 'Vào Cài đặt → Tích hợp hệ thống để đổi Thư mục dữ liệu, sau đó khởi động lại.', type: 'info', sticky: true });
      openSettings();
      break;
    }
    case 'deploy': {
      toast({ title: 'Đang tải bổ sung các thành phần môi trường còn thiếu…', type: 'info', sticky: true, spinner: true });
      await deployAll();
      break;
    }
    case 'lock': {
      const r = await api.clearLocks().catch(() => ({ ok: false }));
      toast(r.ok ? { title: 'Đã dọn dẹp các tệp khóa còn sót lại', type: 'ok' } : { title: 'Dọn dẹp thất bại', body: r.error, type: 'error' });
      break;
    }
    default:
      toast({ title: 'Tạm thời chưa hỗ trợ tự động sửa lỗi', body: issue.hint || '', type: 'info' });
  }
  // 修复后重新自检，刷新横幅与状态
  setTimeout(selfCheck, 600);
  setTimeout(refreshStatus, 600);
}

async function fixAllIssues(issues) {
  const fixable = issues.filter((i) => i.fix);
  for (const i of fixable) {
    // eslint-disable-next-line no-await-in-loop
    await fixIssue(i);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((res) => setTimeout(res, 500));
  }
}

init().catch((e) => {
  console.error(e);
  toast({ title: 'Khởi tạo thất bại', body: e.message, type: 'error', sticky: true });
});
