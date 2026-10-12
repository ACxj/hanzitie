/* 应用逻辑 —— 课时选择、批量生成（页面内预览）、缩放、打印与下载
 *
 * 交互约定：
 *   · 左侧选课时 → 右侧立即预览该课
 *   · 「生成所选课时」→ 在右侧预览区渲染所选全部课时（合并分页），不触发下载
 *   · 「打印」「下载 PNG」→ 对当前预览区已渲染的内容执行操作
 *   · 缩放只影响屏幕预览，打印时自动恢复 100% 且用 300dpi 重绘
 */
(function () {
  'use strict';

  var DATA = window.GRADE_DATA;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    lesson: DATA.lessons[0],
    zoom: 1,
    fitWidth: true,
    pageIndex: 0,
    pages: [],          // 当前预览区的绘制指令列表（可能来自多课）
    cfg: null,
    isBatch: false
  };

  var SCREEN_DPI = 150;   // 屏幕预览分辨率
  var EXPORT_DPI = 300;   // 打印 / 导出分辨率

  var toastTimer;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  /* ================= 课时下拉 ================= */
  // 用 l.no（如「课文1」）作为课时唯一标识符；data.js 没有 id 字段
  function lessonKey(l) { return l.no; }
  function findLesson(key) { return DATA.lessons.filter(function (x) { return x.no === key; })[0]; }

  function initPickers() {
    var units = [];
    DATA.lessons.forEach(function (l) {
      if (units.indexOf(l.unit) === -1) units.push(l.unit);
    });
    var uSel = $('unitSel');
    uSel.innerHTML = units.map(function (u) {
      return '<option value="' + u + '">' + u + '</option>';
    }).join('');

    fillLessonSelect(units[0]);

    uSel.onchange = function () { fillLessonSelect(uSel.value); };
    $('lessonSel').onchange = function () {
      var key = $('lessonSel').value;
      var l = findLesson(key);
      if (l) { state.lesson = l; previewSingle(); }
    };
  }

  function fillLessonSelect(unit) {
    var list = DATA.lessons.filter(function (l) { return l.unit === unit; });
    $('lessonSel').innerHTML = list.map(function (l) {
      return '<option value="' + lessonKey(l) + '">' + l.no + ' 《' + l.title + '》</option>';
    }).join('');
    var cur = list.filter(function (l) { return l.no === (state.lesson && state.lesson.no); })[0] || list[0];
    state.lesson = cur;
    previewSingle();
  }

  /* ================= 批量勾选列表 ================= */
  function initBatch() {
    var units = [];
    DATA.lessons.forEach(function (l) {
      if (units.indexOf(l.unit) === -1) units.push(l.unit);
    });
    var html = '';
    units.forEach(function (u) {
      html += '<div class="batchGroup"><div class="gname">' + u + '</div>';
      DATA.lessons.filter(function (l) { return l.unit === u; }).forEach(function (l) {
        html += '<label class="batchItem"><input type="checkbox" value="' + lessonKey(l) + '">' +
          '<span>' + l.no + ' ' + l.title + '</span>' +
          '<span class="wcount">' + (l.words || []).length + '词</span></label>';
      });
      html += '</div>';
    });
    $('batchList').innerHTML = html;

    $('btnAll').onclick = function () {
      document.querySelectorAll('#batchList input').forEach(function (c) { c.checked = true; });
    };
    $('btnNone').onclick = function () {
      document.querySelectorAll('#batchList input').forEach(function (c) { c.checked = false; });
    };
  }

  function checkedLessons() {
    return Array.prototype.slice
      .call(document.querySelectorAll('#batchList input:checked'))
      .map(function (c) { return findLesson(c.value); })
      .filter(Boolean);
  }

  /* ================= 参数 ================= */
  function getOpts() {
    return {
      s1: $('s1').checked,
      s2: $('s2').checked,
      s3: $('s3').checked,
      editionLabel: DATA.edition + '·' + DATA.grade + '·' + DATA.term
    };
  }

  /* ================= 渲染预览区 ================= */
  // 把若干课的绘制指令合并为一个分页数组
  function buildPages(lessons) {
    var opts = getOpts();
    var pages = [], cfg = null;
    lessons.forEach(function (l, i) {
      var res = window.Layout.compile(l, opts);
      cfg = res.cfg;
      res.pages.forEach(function (ops) {
        // 记录所属课时，页脚与页码按合并后的总页数重算
        pages.push({ ops: ops, lesson: l });
      });
    });
    // 统一重算页脚（页码 / 总页数）
    pages.forEach(function (p, i) {
      var f = p.ops.filter(function (o) { return o.t === 'footer'; })[0];
      if (f) f.right = '第 ' + (i + 1) + ' / ' + pages.length + ' 页';
    });
    return { pages: pages, cfg: cfg };
  }

  // 把分页数组画到预览区
  function paint(sheetList) {
    var host = $('pages');
    // 清空（含 sheetBox 包裹层）
    host.innerHTML = '';
    sheetList.forEach(function (sheet) { host.appendChild(sheet); });
    applyZoom();
    updatePager();
  }

  // 每个 sheet 自带一个 .sheetBox 包裹层（缩放通过 transform + box 尺寸实现，不反复拆装 DOM）
  function renderSheet(ops, cfg, dpi, opts) {
    var sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.appendChild(window.Renderer.renderPage(ops, cfg, dpi, opts));

    var box = document.createElement('div');
    box.className = 'sheetBox';
    box.appendChild(sheet);
    return box;
  }

  /* ---------- 预览单课 ---------- */
  function previewSingle() {
    var opts = getOpts();
    if (!opts.s1 && !opts.s2 && !opts.s3) { toast('请至少勾选一个练习板块'); return; }
    var res = window.Layout.compile(state.lesson, opts);
    // 统一 state.pages 结构为 [{ops, lesson}]，与批量生成一致，避免 doPrint/doDownload 访问 p.ops 时得到 undefined
    state.pages = res.pages.map(function (ops) { return { ops: ops, lesson: state.lesson }; });
    state.cfg = res.cfg;
    state.isBatch = false;
    state.pageIndex = 0;

    paint(state.pages.map(function (p) { return renderSheet(p.ops, res.cfg, SCREEN_DPI, opts); }));

    var l = state.lesson;
    $('lessonMeta').innerHTML = '词语 <b>' + (l.words || []).length + '</b> · 扩词 <b>' +
      (l.extend || []).length + '</b> · 识字表 <b>' + l.read.length + '</b> 字 · 共 <b>' +
      res.pages.length + '</b> 页';
    $('batchHint').textContent = '当前预览：单课';
  }

  /* ---------- 批量生成（在页面内预览） ---------- */
  function generateBatch() {
    var opts = getOpts();
    if (!opts.s1 && !opts.s2 && !opts.s3) { toast('请至少勾选一个练习板块'); return; }

    var lessons = checkedLessons();
    if (!lessons.length) {
      toast('请先在左侧勾选要生成的课时');
      return;
    }

    var built = buildPages(lessons);
    state.pages = built.pages;
    state.cfg = built.cfg;
    state.isBatch = true;
    state.pageIndex = 0;

    paint(built.pages.map(function (p) {
      return renderSheet(p.ops, built.cfg, SCREEN_DPI, opts);
    }));

    var words = 0, extend = 0, read = 0;
    lessons.forEach(function (l) {
      words += (l.words || []).length;
      extend += (l.extend || []).length;
      read += l.read.length;
    });
    $('lessonMeta').innerHTML = '<b>' + lessons.length + '</b> 课 · 词语 <b>' + words +
      '</b> · 扩词 <b>' + extend + '</b> · 识字表 <b>' + read + '</b> 字 · 共 <b>' +
      built.pages.length + '</b> 页';
    $('batchHint').textContent = '当前预览：已生成 ' + lessons.length + ' 课';
    toast('已在预览区生成 ' + lessons.length + ' 课（' + built.pages.length + ' 页），可直接打印或下载');
  }

  /* ================= 缩放（仅影响屏幕预览） ================= */
  function applyZoom() {
    var wrap = $('canvasWrap');
    var sheetW = 210 * 96 / 25.4, sheetH = 297 * 96 / 25.4;

    if (state.fitWidth) {
      state.zoom = Math.min(1.4, Math.max(0.2, (wrap.clientWidth - 24) / sheetW));
    }
    state.zoom = Math.max(0.2, Math.min(2.2, state.zoom));

    var scaledW = sheetW * state.zoom, scaledH = sheetH * state.zoom;

    // 只调整尺寸与缩放，不重建/移动任何 DOM 节点
    var boxes = document.querySelectorAll('.sheetBox');
    Array.prototype.forEach.call(boxes, function (box) {
      box.style.width = scaledW + 'px';
      box.style.height = scaledH + 'px';
      var sheet = box.querySelector('.sheet');
      if (sheet) sheet.style.transform = 'scale(' + state.zoom + ')';
    });

    $('zoomLabel').textContent = Math.round(state.zoom * 100) + '%';
  }

  /* ================= 翻页 ================= */
  function updatePager() {
    var n = state.pages.length || 1;
    $('pager').innerHTML =
      '<button id="pgPrev" ' + (state.pageIndex <= 0 ? 'disabled' : '') + '>‹</button>' +
      '<span>第 ' + (state.pageIndex + 1) + ' / ' + n + ' 页</span>' +
      '<button id="pgNext" ' + (state.pageIndex >= n - 1 ? 'disabled' : '') + '>›</button>';

    var prev = $('pgPrev'), next = $('pgNext');
    if (prev) prev.onclick = function () {
      state.pageIndex = Math.max(0, state.pageIndex - 1);
      updatePager(); scrollToPage(state.pageIndex);
    };
    if (next) next.onclick = function () {
      state.pageIndex = Math.min(n - 1, state.pageIndex + 1);
      updatePager(); scrollToPage(state.pageIndex);
    };
  }

  function scrollToPage(i) {
    var el = document.querySelectorAll('.sheetBox')[i];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ================= 打印 =================
   * 直接复用屏幕预览的 canvas（已是 150dpi×2 = 300dpi 等效清晰度），不再重新渲染 300dpi，
   * 避免批量打印时重复绘制超大 canvas 导致内存爆炸 / 页面假死。
   * 屏幕预览 #pages 完全不动，打印时用 @media print 控制可见性。 */
  function doPrint() {
    if (!state.pages.length) { toast('请先生成内容'); return; }

    toast('请在弹窗中选择打印机或「另存为 PDF」');

    // 直接打印当前屏幕预览（canvas 已是 300dpi 等效分辨率）
    setTimeout(function () { window.print(); }, 50);
  }

  // 检测是否运行在受限 iframe 中（如某些内嵌预览面板会拦截 window.print 弹窗）
  var inRestrictedFrame = false;
  try { inRestrictedFrame = window.self !== window.top; } catch (e) { inRestrictedFrame = true; }
  if (inRestrictedFrame) {
    console.warn('[字帖] 检测到当前页面运行在 iframe 内，打印弹窗可能被浏览器拦截。' +
      '若「打印/存为 PDF」无反应，请用浏览器直接打开本页面（http://localhost:8980/index.html）再打印。');
  }

  /* ================= 下载 PNG（对当前预览内容） ================= */
  function doDownload() {
    if (!state.pages.length) { toast('请先生成内容'); return; }
    var opts = getOpts();

    var jobs = state.pages.map(function (p, i) {
      var name = (state.isBatch ? p.lesson.no + '_' + p.lesson.title : '预览') +
        (state.pages.length > 1 ? '_P' + (i + 1) : '') + '.png';
      return { name: name, ops: p.ops };
    });

    toast('正在导出 ' + jobs.length + ' 张图片…');

    var i = 0;
    function next() {
      if (i >= jobs.length) { toast('完成！共导出 ' + jobs.length + ' 张图片'); return; }
      var job = jobs[i];
      var cvs = window.Renderer.renderPage(job.ops, state.cfg, EXPORT_DPI, opts);
      cvs.toBlob(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = sanitize(job.name);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
        i++;
        next();
      }, 'image/png');
    }
    next();
  }

  function sanitize(name) {
    return name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
  }

  /* ================= 事件绑定 ================= */
  function bind() {
    ['s1', 's2', 's3'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        if (state.isBatch) generateBatch(); else previewSingle();
      });
    });

    $('zoomIn').onclick = function () { state.fitWidth = false; state.zoom += 0.15; applyZoom(); };
    $('zoomOut').onclick = function () { state.fitWidth = false; state.zoom -= 0.15; applyZoom(); };
    $('zoomFit').onclick = function () { state.fitWidth = true; applyZoom(); };

    $('btnPrint').onclick = doPrint;
    $('btnPng').onclick = doDownload;
    // 关键修复：批量生成只在页面内预览，不触发下载
    $('btnBatch').onclick = generateBatch;
    $('btnBack').onclick = previewSingle;

    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { if (state.fitWidth) applyZoom(); }, 120);
    });
  }

  /* ================= 启动 ================= */
  $('editionLabel').textContent = DATA.edition + ' · ' + DATA.grade + ' · ' + DATA.term +
    (DATA.version ? ' · ' + DATA.version : '');
  initPickers();
  initBatch();
  bind();
  previewSingle();
})();