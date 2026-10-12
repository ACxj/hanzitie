/* 布局引擎 —— 以 mm 为单位计算 A4 版面坐标。
 * DOM 预览与 Canvas 导出共用同一份绘制指令，保证「屏幕上看到 = 打印/下载出来」。
 *
 * 版面结构（对齐课本同步字帖）：
 *   标题：课1《XXX》
 *   一：看拼音写字词（课本同步）  → words，按行分组，每字一格，拼音只标首行
 *   二：生字扩词练习              → extend，同上
 *   三：看看生字注音（识字表、二类字）→ read，田字格描红范字（不印拼音，由学生注音）
 */
(function () {
  'use strict';

  var PAGE = { w: 210, h: 297 };   // A4

  var DEFAULTS = {
    marginX: 14,        // 左右页边距
    marginTop: 11,      // 顶边距
    marginBottom: 13,   // 底边距（留给页脚）
    cell: 12.5,         // 单格边长 mm（一、二板块）
    cellGap: 0.8,       // 格间距
    wordGap: 2.6,       // 词与词之间的间距（比格间距大，形成分词感）
    pinyinH: 5.0,       // 拼音行高（下方留一条 pyGap 的空隙 + 分隔线，让拼音与田字格完全分开）
    titleH: 12.5,       // 课名标题高
    subTitleH: 8.2,     // 小节标题高
    blockGap: 6.5,      // 小节间距
    rowGap: 2.6,        // 行间距
    fontKai: 'KaiTi, STKaiti, KaiTi_GB2312, 楷体, SimSun, serif',
    fontPinyin: 'Arial, Helvetica, "PingFang SC", "Microsoft YaHei", sans-serif',
    fontUI: '"Microsoft YaHei", "PingFang SC", sans-serif',
    pinyinFontPt: 9.5,  // 拼音字号（适当放大，更清晰易读）
    ghostFontRatio: 0.76, // 描红范字占格宽比例
    ghostCell: 14.5,    // 描红板块「下格」（范字格）边长 mm
    ghostPerRow: 10,    // 描红板块每行格数
    ghostUpperH: 8.5,   // 描红板块「上格」（写拼音）高度 mm
    ghostBoxGap: 0      // 上下两格相连（共享边线，无间隙）
  };

  function merge(o) {
    var r = {};
    for (var k in DEFAULTS) r[k] = DEFAULTS[k];
    if (o) for (var k2 in o) {
      if (o[k2] !== undefined && o[k2] !== null && o[k2] !== '') r[k2] = o[k2];
    }
    return r;
  }

  // 把词语数组按「每行可用宽度」贪心分组
  // 词语内 cellGap = 0（贴边），因此 selfW / selfEff 都不计 word 内 cellGap
  function groupWords(items, maxW, cell, cellGap, wordGap) {
    var rows = [], cur = [], used = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var n = Math.max(1, it.w ? it.w.length : 1);
      var selfW = n * cell;                              // 词内无 cellGap，所以就是 n*cell
      // 极窄版心下若单词本身就超宽，压缩格宽以保证不越界
      var effCell = selfW > maxW ? Math.max(4, maxW / n) : cell;
      var selfEff = n * effCell;
      var need = selfEff + (cur.length ? wordGap : 0);
      if (cur.length && used + need > maxW) {
        rows.push(cur); cur = []; used = 0; need = selfEff;
      }
      cur.push({ item: it, cell: effCell }); used += need;
    }
    if (cur.length) rows.push(cur);
    return rows;
  }

  function compile(lesson, opts) {
    var c = merge(opts);
    var contentW = PAGE.w - c.marginX * 2;
    var contentBottom = PAGE.h - c.marginBottom;
    var x0 = c.marginX;

    var ops = [], pages = [], y = c.marginTop;
    var curSection = null;   // 当前所属小节，续页时补印标题

    function newPage() {
      if (ops.length) pages.push(ops);
      ops = [];
      y = c.marginTop;
      // 续页补上小节标题，避免内容与标题脱节
      if (curSection) {
        ops.push({ t: 'subtitle', text: curSection.label + '（续）', x: x0, y: y, w: contentW, h: c.subTitleH });
        y += c.subTitleH;
      }
    }
    function fits(h) { return y + h <= contentBottom; }

    /* ---- 标题 ---- */
    if (!fits(c.titleH)) newPage();
    ops.push({ t: 'title', text: lesson.no + ' 《' + lesson.title + '》', x: x0, y: y, w: contentW, h: c.titleH });
    y += c.titleH;

    var sections = [];
    if (c.s1 !== false) sections.push({ label: '一：看拼音写字词（课本同步）', items: lesson.words, ghost: false });
    if (c.s2 !== false) sections.push({ label: '二：生字扩词练习', items: lesson.extend, ghost: false });
    if (c.s3 !== false) sections.push({ label: '三：看看生字注音（识字表、二类字）', items: lesson.read, ghost: true });

    sections.forEach(function (sec, si) {
      if (si > 0) y += c.blockGap;

      // 新小节开始前：先判断能否放下「标题 + 首行内容」，否则换页
      var need = c.subTitleH + (sec.items && sec.items.length ? c.pinyinH + c.cell : c.cell);
      if (!fits(need)) {
        curSection = null;          // 新页是新区开头，不需要「（续）」标题
        newPage();
      }
      curSection = sec;

      ops.push({ t: 'subtitle', text: sec.label, x: x0, y: y, w: contentW, h: c.subTitleH });
      y += c.subTitleH;

      if (!sec.items || !sec.items.length) {
        ops.push({ t: 'note', text: '（本课无此部分内容）', x: x0, y: y, w: contentW, h: 7 });
        y += 7;
        return;
      }

      // 描红板块：每格上下两格 —— 上格为空（学生写拼音），下格给浅色范字（学生描写）
      if (sec.ghost) {
        var upperH = c.ghostUpperH;            // 上格（写拼音）高度
        var boxGap = c.ghostBoxGap;            // 上下两格之间的间隙
        // 下格边长与每行格数都按版心自适应，避免边距变化时出界
        var gCell = c.ghostCell;
        var perRow = c.ghostPerRow;
        var maxFit = Math.floor((contentW + c.cellGap) / (gCell + c.cellGap));
        if (maxFit < 1) { gCell = contentW; perRow = 1; }
        else if (perRow > maxFit) perRow = maxFit;
        var step = gCell + c.cellGap;
        var rowH = upperH + boxGap + gCell;    // 单字单元总高
        var rows = [];
        for (var i = 0; i < sec.items.length; i += perRow) rows.push(sec.items.slice(i, i + perRow));

        rows.forEach(function (r) {
          if (!fits(rowH + 1)) newPage();
          var cells = r.map(function (it, k) {
            return {
              x: x0 + k * step, y: y, w: gCell, h: gCell,
              upperY: y, upperH: upperH, boxGap: boxGap,
              char: it.z || it.w, ghost: true
            };
          });
          ops.push({ t: 'cells', y: y, h: rowH, cells: cells });
          y += rowH + c.rowGap;
        });
        y -= c.rowGap;
      } else {
        var groups = groupWords(sec.items, contentW, c.cell, c.cellGap, c.wordGap);

        groups.forEach(function (rowEntries) {
          // 每行都标拼音：学生照着拼音逐行写，写完一行再写下一行
          var pyH = c.pinyinH;
          // 拼音行与田字格之间留一条细空隙（用于画分隔线），让拼音明显处于"上方区域"
          var pyGap = 0.5;
          // 本行最大格宽（用于判断是否需要翻页）
          var rowCell = c.cell;
          rowEntries.forEach(function (e) { if (e.cell > rowCell) rowCell = e.cell; });
          if (!fits(pyH + pyGap + rowCell)) newPage();

          var pyItems = [], cells = [];
          var x = x0;
          rowEntries.forEach(function (e, eIdx) {
            var it = e.item, cw = e.cell;
            var chars = it.w.split('');
            var syl = it.py.trim().split(/\s+/);
            for (var k = 0; k < chars.length; k++) {
              pyItems.push({ text: syl[k] || '', cx: x + cw / 2 });
              cells.push({
                x: x, y: y + pyH + pyGap, w: cw, h: cw, char: '', ghost: false
              });
              x += cw;                  // 词内格子贴边（相连成一个外框）
            }
            if (eIdx < rowEntries.length - 1) {
              x += c.wordGap;          // 词与词之间保留 wordGap 的视觉空隙
            }
          });

          ops.push({ t: 'pinyin', x: x0, y: y, w: contentW, h: pyH, items: pyItems, ghost: false });
          // 在拼音行与田字格之间画一条浅灰分隔线（视觉上把"拼音区"和"书写区"分开）
          ops.push({ t: 'pyrule', x: x0, y: y + pyH, w: contentW });
          y += pyH + pyGap;
          ops.push({ t: 'cells', y: y, h: rowCell, cells: cells });
          y += rowCell + c.rowGap;
        });
        y -= c.rowGap;
      }
    });

    if (ops.length) pages.push(ops);

    // ---- 页脚 ----
    pages.forEach(function (p, i) {
      p.push({
        t: 'footer', x: x0, y: PAGE.h - c.marginBottom + 4, w: contentW, h: 7,
        left: '【' + (c.editionLabel || '人教版·二年级·上册') + '】' + lesson.no + ' ' + lesson.title,
        right: '第 ' + (i + 1) + ' / ' + pages.length + ' 页'
      });
    });

    return { pages: pages, cfg: c, contentW: contentW };
  }

  window.Layout = { PAGE: PAGE, DEFAULTS: DEFAULTS, compile: compile };
})();
