// static/js/app.js
const initApp = () => {
  /* ─── Константы ───────────────────────────────────────────── */
  const MAX_CLIP_SECONDS = 60;
  const MIN_SCALE        = 1;
  const MAX_SCALE        = 4;
  const SCALE_SENSITIVITY = 0.005;
  const SLIDER_ZOOM_WINDOW_SECONDS = 120;
  const TOOLTIP_MERGE_DISTANCE = 35;

  /* ─── DOM-элементы ────────────────────────────────────────── */
  const fileInput        = document.getElementById('fileInput');
  const touchMeContainer = document.getElementById('touchMeContainer');
  const playerWrapper    = document.getElementById('playerWrapper');
  const videoPreview     = document.getElementById('videoPreview');
  const videoOverlay     = document.getElementById('videoOverlay');
  const deleteButton     = document.getElementById('deleteButton');
  const convertButton    = document.getElementById('convertButton');
  const resizeButton     = document.getElementById('resizeButton');
  const moveButton       = document.getElementById('moveButton');
  const currentTimeSpan  = document.querySelector('#currentTime span');

  const scrubberHandle   = document.getElementById('scrubberHandle');
  const scrubberProgress = document.getElementById('scrubberProgress');
  let   scrubberPathLength = 0;
  if (scrubberProgress) {
    scrubberPathLength = scrubberProgress.getTotalLength();
    scrubberProgress.style.strokeDasharray  = scrubberPathLength;
    scrubberProgress.style.strokeDashoffset = scrubberPathLength;
  }

  const durationSliderEl   = document.getElementById('durationSlider');
  const combinedTooltip    = document.getElementById('combinedTooltip');
  const durationValueLabel = document.getElementById('durationValueLabel');
  const sizeSlider         = document.getElementById('sizeSlider');
  const sizeOut            = document.getElementById('sizeOut');

  /* ─── Состояние ───────────────────────────────────────────── */
  let videoFile      = null;
  let videoObjectURL = null;
  let durationSlider = null;
  let isScrubbing    = false, isResizing = false, isMoving = false;
  let scale   = 1, offsetX = 0, offsetY = 0;
  let startX = 0, startY = 0;
  let startScale  = 1, startMoveX = 0, startMoveY = 0;

  /* ─── Хелперы ─────────────────────────────────────────────── */
  const clamp = (val, min, max) => Math.min(Math.max(val, min), max);
  const formatTime = (seconds) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const updateCurrentTime = () => {
    currentTimeSpan.textContent = formatTime(videoPreview.currentTime);
  };

  const updateRangeFill = (slider) => {
    const min = slider.min || 0;
    const max = slider.max || 100;
    const value = slider.value;
    const percentage = ((value - min) / (max - min)) * 100;
    slider.style.background = `(to right, var(--accent-slider) ${percentage}%, #E0E1E6 ${percentage}%)`;
  };

  const updateScrubberHandle = (time, duration) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    const progress = clamp(time / duration, 0, 1);
    const angle = -75 + progress * 330;
    const x = 100 + 90 * Math.cos(angle * Math.PI / 180);
    const y = 100 + 90 * Math.sin(angle * Math.PI / 180);
    scrubberHandle.setAttribute('cx', x);
    scrubberHandle.setAttribute('cy', y);
    scrubberProgress.style.strokeDashoffset = scrubberPathLength * (1 - progress);
  };

  const applyTransform = () => {
    videoPreview.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  };

  /* ─── Переключение экранов ───────────────────────────────── */
  const showPlayer = () => {
    touchMeContainer.classList.add('hidden');
    playerWrapper.classList.remove('hidden');
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
    updateRangeFill(sizeSlider);
    convertButton.disabled = true;
    playerWrapper.classList.add('hidden');
    touchMeContainer.classList.remove('hidden');
    currentTimeSpan.textContent = '00:00';
  };

  const updateCombinedTooltip = (values, handle, unencoded, tap, positions) => {
    const handles = durationSlider.target.querySelectorAll('.noUi-handle');
    const tooltips = durationSlider.target.querySelectorAll('.noUi-tooltip');
    if (handles.length < 2 || tooltips.length < 2) return;

    const lowerHandle = handles[0];
    const upperHandle = handles[1];
    const distance = positions[1] - positions[0];

    if (distance < TOOLTIP_MERGE_DISTANCE) {
        tooltips[0].classList.add('hidden');
        tooltips[1].classList.add('hidden');
        combinedTooltip.classList.remove('hidden');
        
        combinedTooltip.innerHTML = `${formatTime(values[0])} &mdash; ${formatTime(values[1])}`;
        const sliderRect = durationSlider.target.getBoundingClientRect();
        const midpoint = (lowerHandle.getBoundingClientRect().left + upperHandle.getBoundingClientRect().right) / 2;
        combinedTooltip.style.left = `${midpoint - sliderRect.left}px`;
    } else {
        tooltips[0].classList.remove('hidden');
        tooltips[1].classList.remove('hidden');
        combinedTooltip.classList.add('hidden');
    }
  }

  /* ─── noUiSlider: диапазон длительности ───────────────────── */
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
      behaviour: 'drag',
      tooltips: { to: formatTime, from: Number },
    });

    durationSlider.on('update', (values, handle, unencoded, tap, positions) => {
      const clipDur = values[1] - values[0];
      durationValueLabel.textContent = `${clipDur.toFixed(1)} сек`;
      updateCombinedTooltip(values, handle, unencoded, tap, positions);
    });
    
    durationSlider.set(durationSlider.get());
  };

  /* ─── Загрузка/инициализация видео ────────────────────────── */
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
    updateCurrentTime();
    initDurationSlider(videoPreview.duration);
    convertButton.disabled = false;
    applyTransform();
    updateScrubberHandle(videoPreview.currentTime, videoPreview.duration);
  });

  /* ─── Обновление времени и дуги во время воспроизведения ─── */
  videoPreview.addEventListener('timeupdate', () => {
    if (!isScrubbing) {
      updateScrubberHandle(videoPreview.currentTime, videoPreview.duration);
      updateCurrentTime();
    }
  });

  /* ─── Общие обработчики ───────────────────────────────────── */
  videoPreview.addEventListener('click', () => {
    videoPreview.paused ? videoPreview.play() : videoPreview.pause();
  });
  videoPreview.addEventListener('play', () => videoOverlay.classList.add('hidden'));
  videoPreview.addEventListener('pause', () => videoOverlay.classList.remove('hidden'));

  deleteButton.addEventListener('click', showUploader);

  sizeSlider.addEventListener('input', () => {
    sizeOut.textContent = sizeSlider.value;
    updateRangeFill(sizeSlider);
  });

  /* ─── Круговой скраббер (теперь с функцией "зума") ───────── */
  const startScrub = (event) => {
    isScrubbing = true;
    videoPreview.pause();
    moveScrub(event);
    document.addEventListener('mousemove', moveScrub);
    // ИЗМЕНЕНИЕ ЗДЕСЬ: Добавлен объект опций { passive: false }
    document.addEventListener('touchmove', moveScrub, { passive: false });
    document.addEventListener('mouseup', endScrub);
    document.addEventListener('touchend', endScrub);
    document.addEventListener('mouseleave', endScrub);
  };

  const moveScrub = (event) => {
    event.preventDefault();
    const rect = videoPreview.closest('.video-container').getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const p = event.touches ? event.touches[0] : event;
    const dx = p.clientX - cx;
    const dy = p.clientY - cy;
    let angle = Math.atan2(dy, dx) * 180 / Math.PI + 75;
    if (angle < 0) angle += 360;
    if (angle > 330) angle = angle - 330 < 360 - angle ? 330 : 0;

    const progress = angle / 330;
    const newTime = progress * videoPreview.duration;

    videoPreview.currentTime = newTime;
    updateScrubberHandle(newTime, videoPreview.duration);
    updateCurrentTime();

    if (durationSlider && videoPreview.duration > SLIDER_ZOOM_WINDOW_SECONDS) {
      const halfWindow = SLIDER_ZOOM_WINDOW_SECONDS / 2;
      let newRangeMin = Math.max(0, newTime - halfWindow);
      let newRangeMax = newRangeMin + SLIDER_ZOOM_WINDOW_SECONDS;

      if (newRangeMax > videoPreview.duration) {
        newRangeMax = videoPreview.duration;
        newRangeMin = newRangeMax - SLIDER_ZOOM_WINDOW_SECONDS;
      }
      
      const currentSelection = durationSlider.get();
      const clipLength = currentSelection[1] - currentSelection[0];
      
      durationSlider.updateOptions({
        range: { min: newRangeMin, max: newRangeMax }
      }, false);

      const newStart = clamp(newTime, newRangeMin, newRangeMax - clipLength);
      durationSlider.set([newStart, newStart + clipLength]);
    }
  };

  const endScrub = () => {
    isScrubbing = false;
    document.removeEventListener('mousemove', moveScrub);
    document.removeEventListener('touchmove', moveScrub);
    document.removeEventListener('mouseup', endScrub);
    document.removeEventListener('touchend', endScrub);
    document.removeEventListener('mouseleave', endScrub);
  };

  scrubberHandle.addEventListener('mousedown', startScrub);
  scrubberHandle.addEventListener('touchstart', startScrub, { passive: false });

  /* ─── Зум при перетягивании resize-кнопки ───────────── */
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

  /* ─── Перемещение кадра (Pan/Move) ───────────────── */
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
    const newOffsetX = startMoveX + deltaX;
    const newOffsetY = startMoveY + deltaY;
    offsetX = clamp(newOffsetX, -maxOffset, maxOffset);
    offsetY = clamp(newOffsetY, -maxOffset, maxOffset);
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

  /* ─── Старт ───────────────────────────────────────────────── */
  showUploader();
};

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', initApp)
  : initApp();