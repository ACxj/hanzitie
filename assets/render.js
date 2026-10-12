/* 渲染器 —— 把布局指令绘制到 Canvas。
 * 预览 150dpi / 打印导出 300dpi，均 3x 超采样保证线框锐利。
 */
(function () {
  'use strict';

  function px(mm, dpi) { return mm * dpi / 25.4; }

  /* 田字格线框：绿色实线外框 + 粉红色虚线内十字（对齐课本字帖） */
  function drawGrid(ctx, x, y, w, h, dpi) {
    ctx.save();
    // 外框：绿色实线
    ctx.lineWidth = Math.max(0.9, px(0.38, dpi));
    ctx.strokeStyle = '#3f9c63';
    ctx.setLineDash([]);
    ctx.strokeRect(x, y, w, h);

    // 内部十字：粉红色虚线
    ctx.lineWidth = Math.max(0.5, px(0.22, dpi));
    ctx.strokeStyle = '#e79a9a';
    var dash = px(0.95, dpi);
    ctx.setLineDash([dash, px(0.8, dpi)]);
    ctx.beginPath();
    ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2);   // 横
    ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h);   // 竖
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* 上格专用 —— 拼音「四线三格」：
   * 绿色外框（与田字格一致）+ 内部两条红色虚线（#e79a9a，与田字格十字同款虚线）。
   * 两条虚线在三等分处，与上下框线构成四线三格，学生按格写拼音。
   * 上格与下格相连（共享边线，无间隙）。 */
  function drawGhostGrid(ctx, x, y, w, h, dpi) {
    ctx.save();
    // 外框：绿色实线（与田字格外框一致）
    ctx.lineWidth = Math.max(0.9, px(0.38, dpi));
    ctx.strokeStyle = '#3f9c63';
    ctx.setLineDash([]);
    ctx.strokeRect(x, y, w, h);

    // 内部两条红色虚线（三等分，构成四线三格）
    ctx.lineWidth = Math.max(0.5, px(0.22, dpi));
    ctx.strokeStyle = '#e79a9a';
    var dash = px(0.95, dpi);
    ctx.setLineDash([dash, px(0.8, dpi)]);
    ctx.beginPath();
    ctx.moveTo(x, y + h / 3);     ctx.lineTo(x + w, y + h / 3);
    ctx.moveTo(x, y + h * 2 / 3); ctx.lineTo(x + w, y + h * 2 / 3);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* 一个字格单元 */
  function drawCell(ctx, cell, cfg, dpi, ghostStyle) {
    var x = px(cell.x, dpi);
    var w = px(cell.w, dpi);

    if (cell.ghost) {
      // 描红格：上格（音节盒：两条水平虚线，供写拼音）+ 下格（虚线田字格 + 浅色范字）
      var uy = px(cell.upperY, dpi);
      var uh = px(cell.upperH, dpi);
      drawGhostGrid(ctx, x, uy, w, uh, dpi);   // 上格：上下两条虚线

      var gy = px(cell.upperY + cell.upperH + cell.boxGap, dpi);
      var gh = px(cell.h, dpi);
      drawGrid(ctx, x, gy, w, gh, dpi);        // 下格：标准虚线田字格

      if (cell.char && ghostStyle !== 'hidden') {
        ctx.save();
        ctx.fillStyle = '#1a1a1a';   // 黑色范字（不再用浅灰，便于学生清晰描红）
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = px(cell.w * cfg.ghostFontRatio, dpi) + 'px ' + cfg.fontKai;
        // 用 textBaseline='middle' 直接垂直居中，不再额外偏移（之前 -1.5% 导致偏上）
        ctx.fillText(cell.char, x + w / 2, gy + gh / 2);
        ctx.restore();
      }
      return;
    }

    // 普通书写格
    var y = px(cell.y, dpi), h = px(cell.h, dpi);
    drawGrid(ctx, x, y, w, h, dpi);
  }

  /* 拼音行 —— 用正规无衬线拼音字体（非斜体），文字居中偏下，与田字格之间留白 */
  function drawPinyin(ctx, op, cfg, dpi) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#3d4653';
    // 正规拼音字体：Arial/Helvetica 优先，去掉斜体，字母比例更规范
    ctx.font = px(cfg.pinyinFontPt * 0.3528, dpi) + 'px ' + cfg.fontPinyin;
    var baseline = px(op.y + op.h * 0.62, dpi);
    op.items.forEach(function (it) {
      if (it.text) ctx.fillText(it.text, px(it.cx, dpi), baseline);
    });
    ctx.restore();
  }

  function drawPage(ctx, ops, cfg, dpi, opts) {
    var W = px(210, dpi), H = px(297, dpi);
    var ghostStyle = (opts && opts.ghostStyle) || 'light';

    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    ops.forEach(function (op) {
      switch (op.t) {
        case 'title':
          ctx.save();
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#1a7a4a';
          ctx.font = 'bold ' + px(6.0, dpi) + 'px ' + cfg.fontKai;
          var ty = px(op.y + op.h / 2, dpi);
          ctx.fillText(op.text, px(op.x, dpi), ty);
          ctx.strokeStyle = '#1a7a4a';
          ctx.lineWidth = px(0.34, dpi);
          var tw = ctx.measureText(op.text).width;
          ctx.beginPath();
          ctx.moveTo(px(op.x, dpi), ty + px(3.5, dpi));
          ctx.lineTo(px(op.x, dpi) + tw, ty + px(3.5, dpi));
          ctx.stroke();
          ctx.restore();
          break;

        case 'subtitle':
          ctx.save();
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#2b3442';
          ctx.font = 'bold ' + px(3.9, dpi) + 'px ' + cfg.fontUI;
          ctx.fillText(op.text, px(op.x, dpi), px(op.y + op.h / 2, dpi));
          ctx.restore();
          break;

        case 'note':
          ctx.save();
          ctx.fillStyle = '#a6aeba';
          ctx.font = px(3.4, dpi) + 'px ' + cfg.fontUI;
          ctx.textBaseline = 'middle';
          ctx.fillText(op.text, px(op.x, dpi), px(op.y + op.h / 2, dpi));
          ctx.restore();
          break;

        case 'pinyin':
          drawPinyin(ctx, op, cfg, dpi);
          break;

        case 'pyrule':
          // 拼音与田字格之间的浅色分隔线（点线），视觉上明确"上拼音/下书写"分区
          ctx.save();
          ctx.strokeStyle = '#cfd5de';
          ctx.lineWidth = Math.max(0.4, px(0.18, dpi));
          var dash = px(0.55, dpi);
          ctx.setLineDash([dash, px(0.7, dpi)]);
          ctx.beginPath();
          ctx.moveTo(px(op.x, dpi), px(op.y, dpi));
          ctx.lineTo(px(op.x + op.w, dpi), px(op.y, dpi));
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
          break;

        case 'cells':
          op.cells.forEach(function (c) { drawCell(ctx, c, cfg, dpi, ghostStyle); });
          break;

        case 'footer':
          ctx.save();
          ctx.fillStyle = '#a6aeba';
          ctx.font = px(3.0, dpi) + 'px ' + cfg.fontUI;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          ctx.fillText(op.left, px(op.x, dpi), px(op.y + op.h / 2, dpi));
          ctx.textAlign = 'right';
          ctx.fillText(op.right, px(op.x + op.w, dpi), px(op.y + op.h / 2, dpi));
          ctx.restore();
          break;
      }
    });

    ctx.restore();
  }

  function renderPage(ops, cfg, dpi, opts) {
    var cvs = document.createElement('canvas');
    // 超采样倍率：让实际像素分辨率 = dpi * scale。
    // 屏幕预览 150dpi × 2 = 300 等效，够锐利；
    // 打印/导出 300dpi × 1 = 300（已是打印标准分辨率，再放大纯属浪费内存）。
    // 之前固定 scale=3 导致打印时 300dpi×3=7441×10524px、单页 ~300MB，批量 27 页直接撑爆浏览器内存。
    var scale = (dpi >= 300) ? 1 : 2;
    cvs.width = Math.round(px(210, dpi) * scale);
    cvs.height = Math.round(px(297, dpi) * scale);
    var ctx = cvs.getContext('2d');
    ctx.scale(scale, scale);
    drawPage(ctx, ops, cfg, dpi, opts);
    cvs.style.width = '210mm';
    cvs.style.height = '297mm';
    return cvs;
  }

  window.Renderer = { renderPage: renderPage, px: px };
})();
