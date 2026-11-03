(() => {
  const els = {
    content: document.getElementById('content'),
    fgColor: document.getElementById('fgColor'),
    bgColor: document.getElementById('bgColor'),
    transparentBg: document.getElementById('transparentBg'),
    pixelShape: document.getElementById('pixelShape'),
    errorLevel: document.getElementById('errorLevel'),
    sizePx: document.getElementById('sizePx'),
    showMargin: document.getElementById('showMargin'),
    logoInput: document.getElementById('logoInput'),
    clearLogo: document.getElementById('clearLogo'),
    logoOptions: document.getElementById('logoOptions'),
    logoSize: document.getElementById('logoSize'),
    logoSizeVal: document.getElementById('logoSizeVal'),
    logoBackdrop: document.getElementById('logoBackdrop'),
    scanHint: document.getElementById('scanHint'),
    downloadPng: document.getElementById('downloadPng'),
    canvas: document.getElementById('qrCanvas'),
  };

  const ctx = els.canvas.getContext('2d');

  let logoImage = null;
  let userSetErrorLevel = false;

  els.errorLevel.addEventListener('change', () => {
    userSetErrorLevel = true;
  });

  function roundRectPath(c, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function octagonPath(c, x, y, w, h, cut) {
    const k = Math.max(0, Math.min(cut, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + k, y);
    c.lineTo(x + w - k, y);
    c.lineTo(x + w, y + k);
    c.lineTo(x + w, y + h - k);
    c.lineTo(x + w - k, y + h);
    c.lineTo(x + k, y + h);
    c.lineTo(x, y + h - k);
    c.lineTo(x, y + k);
    c.closePath();
  }

  function diamondPath(c, x, y, w, h) {
    c.beginPath();
    c.moveTo(x + w / 2, y);
    c.lineTo(x + w, y + h / 2);
    c.lineTo(x + w / 2, y + h);
    c.lineTo(x, y + h / 2);
    c.closePath();
  }

  // Draws a single data-module shape into the fill path (caller sets fillStyle).
  function drawModuleShape(c, shape, x, y, cell) {
    switch (shape) {
      case 'square':
        c.fillRect(x, y, cell, cell);
        return;
      case 'rounded':
        roundRectPath(c, x, y, cell, cell, cell * 0.28);
        c.fill();
        return;
      case 'extra-rounded':
        roundRectPath(c, x, y, cell, cell, cell * 0.42);
        c.fill();
        return;
      case 'dots': {
        const r = cell * 0.5 * 0.82;
        c.beginPath();
        c.arc(x + cell / 2, y + cell / 2, r, 0, Math.PI * 2);
        c.fill();
        return;
      }
      case 'classy':
        octagonPath(c, x, y, cell, cell, cell * 0.28);
        c.fill();
        return;
      case 'diamond':
        diamondPath(c, x, y, cell, cell);
        c.fill();
        return;
      default:
        c.fillRect(x, y, cell, cell);
    }
  }

  // Radius/cut fraction of block size used when rendering the large finder-pattern squares.
  function finderShapeFill(c, shape, x, y, size) {
    switch (shape) {
      case 'square':
      case 'diamond':
        c.fillRect(x, y, size, size);
        return;
      case 'rounded':
        roundRectPath(c, x, y, size, size, size * 0.16);
        c.fill();
        return;
      case 'extra-rounded':
        roundRectPath(c, x, y, size, size, size * 0.28);
        c.fill();
        return;
      case 'dots':
        roundRectPath(c, x, y, size, size, size * 0.5);
        c.fill();
        return;
      case 'classy':
        octagonPath(c, x, y, size, size, size * 0.18);
        c.fill();
        return;
      default:
        c.fillRect(x, y, size, size);
    }
  }

  function drawFinderPattern(c, shape, originX, originY, cell, fgColor) {
    const outer = cell * 7;
    const innerGap = cell * 5;
    const core = cell * 3;

    c.fillStyle = fgColor;
    finderShapeFill(c, shape, originX, originY, outer);

    // Punch the light ring out (back to transparent/base background).
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = 'rgba(0,0,0,1)';
    finderShapeFill(c, shape, originX + cell, originY + cell, innerGap);
    c.restore();

    c.fillStyle = fgColor;
    finderShapeFill(c, shape, originX + cell * 2, originY + cell * 2, core);
  }

  function isInFinderZone(row, col, moduleCount) {
    if (row < 7 && col < 7) return true;
    if (row < 7 && col >= moduleCount - 7) return true;
    if (row >= moduleCount - 7 && col < 7) return true;
    return false;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function render() {
    const text = els.content.value || '';
    const shape = els.pixelShape.value;
    const fgColor = els.fgColor.value;
    const bgColor = els.bgColor.value;
    const transparent = els.transparentBg.checked;
    const errorLevel = els.errorLevel.value;
    const includeMargin = els.showMargin.checked;
    let size = parseInt(els.sizePx.value, 10);
    if (!Number.isFinite(size) || size < 50) size = 50;
    if (size > 4000) size = 4000;

    let qr;
    try {
      qr = qrcode(0, errorLevel);
      qr.addData(text.length ? text : ' ');
      qr.make();
    } catch (e) {
      ctx.fillStyle = '#c0392b';
      ctx.font = '16px sans-serif';
      ctx.fillText('Could not encode this content.', 10, 30);
      return;
    }

    const moduleCount = qr.getModuleCount();
    const margin = includeMargin ? 4 : 0;
    const totalModules = moduleCount + margin * 2;

    // Whole pixels per module keep module edges crisp (no anti-aliased seams between neighbours).
    const cell = Math.max(1, Math.round(size / totalModules));
    size = cell * totalModules;
    els.canvas.width = size;
    els.canvas.height = size;
    ctx.clearRect(0, 0, size, size);

    if (!transparent) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, size, size);
    }

    ctx.fillStyle = fgColor;
    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (isInFinderZone(row, col, moduleCount)) continue;
        if (!qr.isDark(row, col)) continue;
        const x = (col + margin) * cell;
        const y = (row + margin) * cell;
        drawModuleShape(ctx, shape, x, y, cell);
      }
    }

    const corners = [
      [margin, margin],
      [margin, margin + moduleCount - 7],
      [margin + moduleCount - 7, margin],
    ];
    corners.forEach(([r, c]) => {
      drawFinderPattern(ctx, shape, c * cell, r * cell, cell, fgColor);
    });

    if (logoImage) {
      const logoFrac = parseInt(els.logoSize.value, 10) / 100;
      const logoSize = size * logoFrac;
      const logoX = (size - logoSize) / 2;
      const logoY = (size - logoSize) / 2;

      if (els.logoBackdrop.checked) {
        const pad = logoSize * 0.14;
        const backdropColor = transparent ? '#ffffff' : bgColor;
        ctx.fillStyle = backdropColor;
        roundRectPath(ctx, logoX - pad, logoY - pad, logoSize + pad * 2, logoSize + pad * 2, (logoSize + pad * 2) * 0.12);
        ctx.fill();
      }

      const iw = logoImage.width;
      const ih = logoImage.height;
      const scale = Math.min(logoSize / iw, logoSize / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.drawImage(logoImage, logoX + (logoSize - dw) / 2, logoY + (logoSize - dh) / 2, dw, dh);
    }

    updateHint();
  }

  function updateHint() {
    if (logoImage && els.errorLevel.value !== 'H') {
      els.scanHint.hidden = false;
      els.scanHint.textContent = 'Tip: with a center image, use High (H) error correction for reliable scanning.';
    } else {
      els.scanHint.hidden = true;
    }
  }

  const scheduleRender = debounce(render, 60);

  [
    els.content,
    els.fgColor,
    els.bgColor,
    els.transparentBg,
    els.pixelShape,
    els.errorLevel,
    els.sizePx,
    els.showMargin,
    els.logoSize,
    els.logoBackdrop,
  ].forEach((el) => {
    el.addEventListener('input', scheduleRender);
    el.addEventListener('change', scheduleRender);
  });

  els.logoSize.addEventListener('input', () => {
    els.logoSizeVal.textContent = els.logoSize.value + '%';
  });

  els.logoInput.addEventListener('change', () => {
    const file = els.logoInput.files && els.logoInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        logoImage = img;
        els.logoOptions.hidden = false;
        els.clearLogo.hidden = false;
        if (!userSetErrorLevel) {
          els.errorLevel.value = 'H';
        }
        render();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

  els.clearLogo.addEventListener('click', () => {
    logoImage = null;
    els.logoInput.value = '';
    els.logoOptions.hidden = true;
    els.clearLogo.hidden = true;
    render();
  });

  els.downloadPng.addEventListener('click', () => {
    els.canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'qrcode.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/png');
  });

  render();
})();
