// static/js/app.js
const initApp = () => {
  /* ─── Константы ───────────────────────────────────────────── */
  const MAX_CLIP_SECONDS = 60;
  const MIN_SCALE        = 1;   // 100 %
  const MAX_SCALE        = 4;   // 400 %
  const SCALE_SENSITIVITY = 0.005; // чем меньше — тем “медленнее” зум

  /* ─── DOM-элементы ────────────────────────────────────────── */
  const fileInput        = document.getElementById('fileInput');
  const touchMeContainer = document.getElementById('touchMeContainer');
  const playerWrapper    = document.getElementById('playerWrapper');
  const videoPreview     = document.getElementById('videoPreview');
  const videoOverlay     = document.getElementById('videoOverlay');
  const deleteButton     = document.getElementById('deleteButton');
  const convertButton    = document.getElementById('convertButton');
  const resizeButton     = document.getElementById('resizeButton');  // ID ИЗМЕНЕН
  const currentTimeSpan  = document.querySelector('#currentTime span');

  // Круговой скраббер
  const scrubberHandle   = document.getElementById('scrubberHandle');
  const scrubberProgress = document.getElementById('scrubberProgress');
  let   scrubberPathLength = 0;
  if (scrubberProgress) {
    scrubberPathLength                 = scrubberProgress.getTotalLength();
    scrubberProgress.style.strokeDasharray  = scrubberPathLength;
    scrubberProgress.style.strokeDashoffset = scrubberPathLength;
  }

  // Другие контролы
  const durationSliderEl   = document.getElementById('durationSlider');
  const durationValueLabel = document.getElementById('durationValueLabel');
  const sizeSlider         = document.getElementById('sizeSlider');
  const sizeOut            = document.getElementById('sizeOut');

  /* ─── Состояние ───────────────────────────────────────────── */
  let videoFile      = null;
  let videoObjectURL = null;
  let durationSlider = null;
  let isScrubbing    = false;

  let scale   = 1;   // коэффициент зума (1 … 4)
  let offsetX = 0;   // пригодится на шаге 4
  let offsetY = 0;

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
    const min        = slider.min || 0;
    const max        = slider.max || 100;
    const value      = slider.value;
    const percentage = ((value - min) / (max - min)) * 100;
    const c          = '#606680';
    slider.style.background = `linear-gradient(to right, ${c} ${percentage}%, #E0E1E6 ${percentage}%)`;
  };

  /** Пересчёт позиции “точки” на дуге прогресс-бара */
  const updateScrubberHandle = (time, duration) => {
    if (!Number.isFinite(duration) || duration <= 0) return;

    const progress = Math.max(0, Math.min(1, time / duration));
    const angle    = -75 + progress * 330;
    const x = 100 + 90 * Math.cos(angle * Math.PI / 180);
    const y = 100 + 90 * Math.sin(angle * Math.PI / 180);

    scrubberHandle.setAttribute('cx', x);
    scrubberHandle.setAttribute('cy', y);

    scrubberProgress.style.strokeDashoffset =
      scrubberPathLength * (1 - progress);
  };

  /** Применяет текущие offset/scale к видео */
  const applyTransform = () => {
    videoPreview.style.transform =
      `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  };

  /* ─── Переключение экранов ───────────────────────────────── */
  const showPlayer = () => {
    touchMeContainer.classList.add('hidden');
    playerWrapper.classList.remove('hidden');
  };

  const showUploader = () => {
    if (videoObjectURL) URL.revokeObjectURL(videoObjectURL);
    if (durationSlider) durationSlider.destroy();

    videoPreview.src  = '';
    videoObjectURL    = null;
    videoFile         = null;
    fileInput.value   = '';
    durationSlider    = null;

    scale = 1; offsetX = offsetY = 0; applyTransform();

    sizeSlider.value  = 640;
    sizeOut.textContent = sizeSlider.value;
    updateRangeFill(sizeSlider);

    convertButton.disabled = true;
    playerWrapper.classList.add('hidden');
    touchMeContainer.classList.remove('hidden');
    currentTimeSpan.textContent = '00:00';
  };

  /* ─── noUiSlider: диапазон длительности ───────────────────── */
  const initDurationSlider = (videoDuration) => {
    const start = 0;
    const end   = Math.min(videoDuration, MAX_CLIP_SECONDS);

    if (durationSlider) durationSlider.destroy();

    durationSlider = noUiSlider.create(durationSliderEl, {
      start:    [start, end],
      connect:  true,
      range:    { min: 0, max: videoDuration },
      limit:    MAX_CLIP_SECONDS,
      behaviour:'drag',
      tooltips: {
        to:   (v) => formatTime(v),
        from: (v) => v
      }
    });

    durationSlider.on('update', (values) => {
      const clipDur = values[1] - values[0];
      durationValueLabel.textContent = `${clipDur.toFixed(1)} сек`;
    });
  };

  /* ─── Загрузка/инициализация видео ────────────────────────── */
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('video/')) {
      videoFile       = file;
      videoObjectURL  = URL.createObjectURL(videoFile);
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

  /* ─── Клик = play/pause ───────────────────────────────────── */
  videoPreview.addEventListener('click', () => {
    videoPreview.paused ? videoPreview.play() : videoPreview.pause();
  });
  videoPreview.addEventListener('play',  () => videoOverlay.classList.add('hidden'));
  videoPreview.addEventListener('pause', () => videoOverlay.classList.remove('hidden'));

  deleteButton.addEventListener('click', showUploader);

  sizeSlider.addEventListener('input', () => {
    sizeOut.textContent = sizeSlider.value;
    updateRangeFill(sizeSlider);
  });

  /* ─── Круговой скраббер ───────────────────── */
  const startScrub = (event) => {
    isScrubbing = true;
    videoPreview.pause();
    moveScrub(event);
    document.addEventListener('mousemove', moveScrub);
    document.addEventListener('touchmove', moveScrub);
    document.addEventListener('mouseup',   endScrub);
    document.addEventListener('touchend',  endScrub);
    document.addEventListener('mouseleave',endScrub);
  };

  const moveScrub = (event) => {
    event.preventDefault();
    const rect = videoPreview.closest('.video-container').getBoundingClientRect();
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;

    const p  = event.touches ? event.touches[0] : event;
    const dx = p.clientX - cx;
    const dy = p.clientY - cy;
    let angle = Math.atan2(dy, dx) * 180 / Math.PI + 75;
    if (angle < 0) angle += 360;

    if (angle > 330) angle = angle - 330 < 360 - angle ? 330 : 0;

    const progress = angle / 330;
    videoPreview.currentTime = progress * videoPreview.duration;
    updateScrubberHandle(videoPreview.currentTime, videoPreview.duration);
    updateCurrentTime();
  };

  const endScrub = () => {
    isScrubbing = false;
    document.removeEventListener('mousemove', moveScrub);
    document.removeEventListener('touchmove', moveScrub);
    document.removeEventListener('mouseup',   endScrub);
    document.removeEventListener('touchend',  endScrub);
    document.removeEventListener('mouseleave',endScrub);
  };

  scrubberHandle.addEventListener('mousedown', startScrub);
  scrubberHandle.addEventListener('touchstart', startScrub, { passive:false });

  /* ─── Зум при перетягивании resize-кнопки ───────────── */
  let isResizing  = false;
  let startY      = 0;
  let startScale  = 1;

  const onResizeStart = (e) => {
    e.preventDefault();
    const p = e.touches ? e.touches[0] : e;
    isResizing = true;
    startY     = p.clientY;
    startScale = scale;
    document.addEventListener('pointermove', onResizeMove);
    document.addEventListener('pointerup',   onResizeEnd);
  };

  const onResizeMove = (e) => {
    if (!isResizing) return;
    const p = e.touches ? e.touches[0] : e;
    const deltaY  = p.clientY - startY;
    const newScale = clamp(
      startScale - deltaY * SCALE_SENSITIVITY,
      MIN_SCALE,
      MAX_SCALE
    );
    if (newScale !== scale) {
      scale = newScale;
      applyTransform();
    }
  };

  const onResizeEnd = () => {
    isResizing = false;
    document.removeEventListener('pointermove', onResizeMove);
    document.removeEventListener('pointerup',   onResizeEnd);
  };

  resizeButton.addEventListener('pointerdown', onResizeStart);
  resizeButton.addEventListener('touchstart',  onResizeStart, { passive:false });

  /* ─── Старт ───────────────────────────────────────────────── */
  showUploader();
};

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', initApp)
  : initApp();