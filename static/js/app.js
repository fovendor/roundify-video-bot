// static/js/app.js
const initApp = () => {
  /* ─── Константы ───────────────────────────────────────────── */
  const MAX_CLIP_SECONDS = 60;
  const MIN_SCALE = 1;
  const MAX_SCALE = 4;
  const SCALE_SENSITIVITY = 0.005;
  const SLIDER_ZOOM_WINDOW_SECONDS = 120;
  const TOOLTIP_MERGE_DISTANCE = 50;
  const SCRUBBER_RADIUS = 90; // Радиус нашего кругового скраббера из SVG path

  /* ─── DOM-элементы ────────────────────────────────────────── */
  const uploadScreen = document.getElementById('uploadScreen');
  const playerScreen = document.getElementById('playerScreen');

  const fileInput = document.getElementById('fileInput');
  const videoPreview = document.getElementById('videoPreview');
  const videoOverlay = document.getElementById('videoOverlay');

  const moveButton = document.getElementById('moveButton');
  const resizeButton = document.getElementById('resizeButton');
  const currentTime = document.getElementById('currentTime');
  const deleteButton = document.getElementById('deleteButton');

  const scrubberHandle = document.getElementById('scrubberHandle');
  const scrubberProgress = document.getElementById('scrubberProgress');
  let scrubberPathLength = 0;
  if (scrubberProgress) {
    scrubberPathLength = scrubberProgress.getTotalLength();
    scrubberProgress.style.strokeDasharray = scrubberPathLength;
    scrubberProgress.style.strokeDashoffset = scrubberPathLength;
  }

  const durationSliderEl = document.getElementById('durationSlider');
  const combinedTooltip = document.getElementById('combinedTooltip');
  const durationValueLabel = document.getElementById('durationValueLabel');

  const sizeSlider = document.getElementById('sizeSlider');
  const sizeOut = document.getElementById('sizeOut');
  const convertButton = document.getElementById('convertButton');

  /* ─── Состояние ───────────────────────────────────────────── */
  let videoFile = null;
  let videoObjectURL = null;
  let durationSlider = null;
  let isScrubbing = false, isResizing = false, isMoving = false;
  let scale = 1, offsetX = 0, offsetY = 0;
  let startX = 0, startY = 0;
  let startScale = 1, startMoveX = 0, startMoveY = 0;

  /* ─── Хелперы ─────────────────────────────────────────────── */
  const clamp = (val, min, max) => Math.min(Math.max(val, min), max);
  const formatTime = (seconds) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const applyTransform = () => {
    videoPreview.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  };

  // НОВАЯ ФУНКЦИЯ для фиксации размеров дотика и дуги
  const updateScrubberAppearance = () => {
    if (!scrubberProgress) return;
    const svg = scrubberProgress.ownerSVGElement;
    const bgTrack = svg.querySelector('.scrubber-track-bg');
    const currentWidth = svg.getBoundingClientRect().width;
    const viewBoxWidth = svg.viewBox.baseVal.width;

    if (currentWidth === 0 || viewBoxWidth === 0) return;

    const scaleFactor = currentWidth / viewBoxWidth;

    // Целевые размеры в пикселях (соответствуют другим слайдерам)
    const targetStrokeWidth = 8;
    const targetHandleRadius = 11; // Диаметр 22px

    const newStrokeWidth = targetStrokeWidth / scaleFactor;
    const newHandleRadius = targetHandleRadius / scaleFactor;

    scrubberProgress.style.strokeWidth = newStrokeWidth;
    bgTrack.style.strokeWidth = newStrokeWidth;
    scrubberHandle.setAttribute('r', newHandleRadius);
  };

  const updateScrubberHandle = (time, duration) => {
    if (!scrubberProgress || !Number.isFinite(duration) || duration <= 0) return;
    const progress = clamp(time / duration, 0, 1);

    scrubberProgress.style.strokeDashoffset = scrubberPathLength * (1 - progress);

    const point = scrubberProgress.getPointAtLength(progress * scrubberPathLength);
    scrubberHandle.setAttribute('cx', point.x);
    scrubberHandle.setAttribute('cy', point.y);
  };

  /* ─── Переключение экранов ───────────────────────────────── */
  const showPlayer = () => {
    uploadScreen.classList.add('hidden');
    playerScreen.classList.remove('hidden');
  };

  const showUploader = () => {
    if (videoObjectURL) URL.revokeObjectURL(videoObjectURL);
    if (durationSlider) durationSlider.destroy();

    videoPreview.src = '';
    videoObjectURL = null;
    videoFile = null;
    fileInput.value = '';
    durationSlider = null;

    scale = 1; offsetX = 0; offsetY = 0; applyTransform();
    sizeSlider.value = 640;
    sizeOut.textContent = sizeSlider.value;

    convertButton.disabled = true;
    playerScreen.classList.add('hidden');
    uploadScreen.classList.remove('hidden');
    currentTime.textContent = '00:00';
  };

  const updateCombinedTooltip = (values, handle, unencoded, tap, positions) => {
    const handles = durationSlider.target.querySelectorAll('.noUi-handle');
    if (handles.length < 2) return;
    const distance = positions[1] - positions[0];
    if (distance < TOOLTIP_MERGE_DISTANCE) {
      combinedTooltip.classList.remove('hidden');
      combinedTooltip.innerHTML = `${formatTime(values[0])} &mdash; ${formatTime(values[1])}`;
      const sliderRect = durationSlider.target.getBoundingClientRect();
      const midpoint = (handles[0].getBoundingClientRect().left + handles[1].getBoundingClientRect().right) / 2;
      combinedTooltip.style.left = `${midpoint - sliderRect.left}px`;
    } else {
      combinedTooltip.classList.add('hidden');
    }
  };

  const initDurationSlider = (videoDuration) => {
    const start = 0;
    const end = Math.min(videoDuration, MAX_CLIP_SECONDS);
    const initialRangeMax = Math.min(videoDuration, SLIDER_ZOOM_WINDOW_SECONDS);

    if (durationSlider) durationSlider.destroy();

    durationSlider = noUiSlider.create(durationSliderEl, {
      start: [start, end],
      connect: true,
      range: { min: 0, max: initialRangeMax },
      limit: MAX_CLIP_SECONDS,
      behaviour: 'drag-tap',
      tooltips: { to: formatTime, from: Number },
    });

    durationSlider.on('update', (values, handle, unencoded, tap, positions) => {
      const clipDur = values[1] - values[0];
      durationValueLabel.textContent = `${clipDur.toFixed(1)} сек`;
      if (handle === 0) videoPreview.currentTime = values[0];
      updateCombinedTooltip(values, handle, unencoded, tap, positions);
    });

    durationSlider.on('tap', () => {
      const clickedValue = Number(durationSlider.get(true));
      if (videoPreview.duration > SLIDER_ZOOM_WINDOW_SECONDS) {
        updateSliderZoom(clickedValue);
      }
    });

    durationSlider.set(durationSlider.get());
  };

  const updateSliderZoom = (centerTime) => {
    const halfWindow = SLIDER_ZOOM_WINDOW_SECONDS / 2;
    let newRangeMin = Math.max(0, centerTime - halfWindow);
    let newRangeMax = newRangeMin + SLIDER_ZOOM_WINDOW_SECONDS;

    if (newRangeMax > videoPreview.duration) {
      newRangeMax = videoPreview.duration;
      newRangeMin = Math.max(0, newRangeMax - SLIDER_ZOOM_WINDOW_SECONDS);
    }

    const currentSelection = durationSlider.get().map(Number);
    const clipLength = currentSelection[1] - currentSelection[0];

    durationSlider.updateOptions({
      range: { min: newRangeMin, max: newRangeMax }
    }, false);

    const newStart = clamp(centerTime, newRangeMin, newRangeMax - clipLength);
    durationSlider.set([newStart, newStart + clipLength]);
  };

  /* ─── Загрузка и управление видео ─────────────────────────── */
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('video/')) {
      videoFile = file;
      videoObjectURL = URL.createObjectURL(videoFile);
      videoPreview.src = videoObjectURL;
      videoPreview.load();
    }
  });

  videoPreview.addEventListener('loadedmetadata', () => {
    showPlayer();
    initDurationSlider(videoPreview.duration);
    convertButton.disabled = false;
    applyTransform();
    updateScrubberHandle(0, videoPreview.duration);
    updateScrubberAppearance(); // ИЗМЕНЕНИЕ: Вызываем функцию для фиксации размеров
  });

  videoPreview.addEventListener('timeupdate', () => {
    const time = videoPreview.currentTime;
    if (!isScrubbing) {
      currentTime.textContent = formatTime(time);
      updateScrubberHandle(time, videoPreview.duration);
    }
  });

  videoPreview.addEventListener('click', () => {
    videoPreview.paused ? videoPreview.play() : videoPreview.pause();
  });
  videoPreview.addEventListener('play', () => videoOverlay.classList.add('hidden'));
  videoPreview.addEventListener('pause', () => videoOverlay.classList.remove('hidden'));

  deleteButton.addEventListener('click', showUploader);

  /* ─── ЛОГИКА КРУГОВОГО СКРАББЕРА --- */
  const startScrub = (event) => {
    isScrubbing = true;
    videoPreview.pause();
    moveScrub(event);
    document.addEventListener('mousemove', moveScrub);
    document.addEventListener('touchmove', moveScrub, { passive: false });
    document.addEventListener('mouseup', endScrub);
    document.addEventListener('touchend', endScrub);
    document.addEventListener('mouseleave', endScrub);
  };

  const moveScrub = (event) => {
    event.preventDefault();
    const svgRect = scrubberHandle.ownerSVGElement.getBoundingClientRect();
    const cx = svgRect.left + svgRect.width / 2;
    const cy = svgRect.top + svgRect.height / 2;

    const p = event.touches ? event.touches[0] : event;
    let angle = Math.atan2(p.clientY - cy, p.clientX - cx) * 180 / Math.PI;

    angle = (angle + 360 + 75) % 360;

    if (angle < 330) {
      const progress = angle / 330;
      const newTime = progress * videoPreview.duration;

      videoPreview.currentTime = newTime;
      updateScrubberHandle(newTime, videoPreview.duration);
      currentTime.textContent = formatTime(newTime);
    }
  };

  const endScrub = () => {
    isScrubbing = false;
    if (videoPreview.duration > SLIDER_ZOOM_WINDOW_SECONDS) {
      updateSliderZoom(videoPreview.currentTime);
    }
    document.removeEventListener('mousemove', moveScrub);
    document.removeEventListener('touchmove', moveScrub);
    document.removeEventListener('mouseup', endScrub);
    document.removeEventListener('touchend', endScrub);
    document.removeEventListener('mouseleave', endScrub);
  };

  scrubberHandle.addEventListener('mousedown', startScrub);
  scrubberHandle.addEventListener('touchstart', startScrub, { passive: false });

  /* ─── Зум и перемещение кадра ────────────────────────────── */
  const onResizeStart = (e) => {
    e.preventDefault();
    const p = e.touches ? e.touches[0] : e;
    isResizing = true;
    startY = p.clientY;
    startScale = scale;
    document.addEventListener('pointermove', onResizeMove);
    document.addEventListener('pointerup', onResizeEnd);
  };

  const onResizeMove = (e) => {
    if (!isResizing) return;
    const p = e.touches ? e.touches[0] : e;
    const deltaY = p.clientY - startY;
    const newScale = clamp(startScale - deltaY * SCALE_SENSITIVITY, MIN_SCALE, MAX_SCALE);
    if (newScale !== scale) {
      scale = newScale;
      const maxOffset = (videoPreview.offsetWidth * (scale - 1)) / 2;
      offsetX = clamp(offsetX, -maxOffset, maxOffset);
      offsetY = clamp(offsetY, -maxOffset, maxOffset);
      applyTransform();
    }
  };

  const onResizeEnd = () => {
    isResizing = false;
    document.removeEventListener('pointermove', onResizeMove);
    document.removeEventListener('pointerup', onResizeEnd);
  };

  resizeButton.addEventListener('pointerdown', onResizeStart);
  resizeButton.addEventListener('touchstart', onResizeStart, { passive: false });

  const onMoveStart = (e) => {
    e.preventDefault();
    const p = e.touches ? e.touches[0] : e;
    isMoving = true;
    startX = p.clientX;
    startY = p.clientY;
    startMoveX = offsetX;
    startMoveY = offsetY;
    document.body.style.cursor = 'move';
    document.addEventListener('pointermove', onMoveMove);
    document.addEventListener('pointerup', onMoveEnd);
  };

  const onMoveMove = (e) => {
    if (!isMoving) return;
    const p = e.touches ? e.touches[0] : e;
    const deltaX = p.clientX - startX;
    const deltaY = p.clientY - startY;
    const maxOffset = (videoPreview.offsetWidth * (scale - 1)) / 2;
    offsetX = clamp(startMoveX + deltaX, -maxOffset, maxOffset);
    offsetY = clamp(startMoveY + deltaY, -maxOffset, maxOffset);
    applyTransform();
  };

  const onMoveEnd = () => {
    isMoving = false;
    document.body.style.cursor = 'default';
    document.removeEventListener('pointermove', onMoveMove);
    document.removeEventListener('pointerup', onMoveEnd);
  };

  moveButton.addEventListener('pointerdown', onMoveStart);
  moveButton.addEventListener('touchstart', onMoveStart, { passive: false });

  sizeSlider.addEventListener('input', () => {
    sizeOut.textContent = sizeSlider.value;
  });

  // ИЗМЕНЕНИЕ: Добавляем слушатель на ресайз окна
  window.addEventListener('resize', updateScrubberAppearance);

  showUploader();
};

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', initApp)
  : initApp();