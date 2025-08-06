const initApp = () => {
  // --- Константы и Настройки ---
  const MAX_CLIP_SECONDS = 60;

  // --- DOM элементы ---
  const fileInput = document.getElementById('fileInput');
  const touchMeContainer = document.getElementById('touchMeContainer');
  const playerWrapper = document.getElementById('playerWrapper');
  const videoPreview = document.getElementById('videoPreview');
  const videoOverlay = document.getElementById('videoOverlay');
  const deleteButton = document.getElementById('deleteButton');
  const convertButton = document.getElementById('convertButton');

  // Элементы управления
  const scrubberHandle = document.getElementById('scrubberHandle');
  const durationSliderEl = document.getElementById('durationSlider');
  const durationValueLabel = document.getElementById('durationValueLabel');
  const sizeSlider = document.getElementById('sizeSlider');
  const sizeOut = document.getElementById('sizeOut');

  if (!fileInput || !scrubberHandle || !durationSliderEl) {
    console.error('Критическая ошибка: один или несколько HTML-элементов не найдены.');
    return;
  }

  // --- Переменные состояния ---
  let videoFile = null;
  let videoObjectURL = null;
  let durationSlider = null;
  let isScrubbing = false;

  // --- Хелперы ---

  const formatTime = (seconds) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  /** Обновляет позицию ручки кругового скраббера на основе времени видео */
  const updateScrubberHandle = (time, duration) => {
    // [ИЗМЕНЕНИЕ] Более надежная проверка для предотвращения ошибок NaN.
    // Прерываем выполнение, если длительность или время не являются валидными числами.
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(time)) {
      return;
    }
    const angle = (time / duration) * 360 - 90;
    const x = 100 + 90 * Math.cos(angle * Math.PI / 180);
    const y = 100 + 90 * Math.sin(angle * Math.PI / 180);
    scrubberHandle.setAttribute('cx', x);
    scrubberHandle.setAttribute('cy', y);
  };

  // --- Функции переключения UI ---
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

    convertButton.disabled = true;
    playerWrapper.classList.add('hidden');
    touchMeContainer.classList.remove('hidden');
  };

  // --- Инициализация элементов управления ---

  const initDurationSlider = (videoDuration) => {
    const start = 0;
    const end = Math.min(videoDuration, MAX_CLIP_SECONDS);

    if (durationSlider) durationSlider.destroy();

    durationSlider = noUiSlider.create(durationSliderEl, {
      start: [start, end],
      connect: true,
      range: { min: 0, max: videoDuration },
      limit: MAX_CLIP_SECONDS,
      behaviour: 'drag',
      tooltips: {
        to: (value) => formatTime(value),
        from: (value) => value
      }
    });

    durationSlider.on('update', (values) => {
      const clipDuration = values[1] - values[0];
      durationValueLabel.textContent = `${clipDuration.toFixed(1)} сек`;
    });
  };

  // --- Обработчики событий ---

  fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('video/')) {
      videoFile = file;
      videoObjectURL = URL.createObjectURL(videoFile);
      videoPreview.src = videoObjectURL;
      videoPreview.load();
    }
  });

  videoPreview.addEventListener('loadedmetadata', () => {
    showPlayer();
    videoPreview.muted = false;
    videoOverlay.classList.remove('hidden');
    updateScrubberHandle(0, videoPreview.duration);
    initDurationSlider(videoPreview.duration);
    convertButton.disabled = false;
  });

  videoPreview.addEventListener('timeupdate', () => {
    if (!isScrubbing) {
      updateScrubberHandle(videoPreview.currentTime, videoPreview.duration);
    }
  });

  videoPreview.addEventListener('click', () => {
    videoPreview.paused ? videoPreview.play() : videoPreview.pause();
  });

  videoPreview.addEventListener('play', () => videoOverlay.classList.add('hidden'));
  videoPreview.addEventListener('pause', () => videoOverlay.classList.remove('hidden'));

  deleteButton.addEventListener('click', showUploader);

  sizeSlider.addEventListener('input', () => sizeOut.textContent = sizeSlider.value);

  // --- Логика кругового скраббера ---

  const handleScrub = (event) => {
    event.preventDefault();
    const rect = videoPreview.closest('.video-container').getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const clientX = event.clientX || event.touches[0].clientX;
    const clientY = event.clientY || event.touches[0].clientY;

    const angle = Math.atan2(clientY - centerY, clientX - centerX) * 180 / Math.PI + 90;
    const normalizedAngle = (angle + 360) % 360;
    const newTime = (normalizedAngle / 360) * videoPreview.duration;

    videoPreview.currentTime = newTime;
    updateScrubberHandle(newTime, videoPreview.duration);
  };

  const startScrubbing = (event) => {
    isScrubbing = true;
    videoPreview.pause();
    document.addEventListener('mousemove', handleScrub);
    document.addEventListener('touchmove', handleScrub);
    document.addEventListener('mouseup', stopScrubbing);
    document.addEventListener('touchend', stopScrubbing);
    // [ИЗМЕНЕНИЕ] Добавляем обработчик на случай, если мышь покинет окно браузера
    document.addEventListener('mouseleave', stopScrubbing);
  };

  const stopScrubbing = () => {
    // [ИЗМЕНЕНИЕ] Проверяем, был ли скраббинг активен, чтобы не удалять обработчики лишний раз
    if (!isScrubbing) return;
    isScrubbing = false;
    document.removeEventListener('mousemove', handleScrub);
    document.removeEventListener('touchmove', handleScrub);
    document.removeEventListener('mouseup', stopScrubbing);
    document.removeEventListener('touchend', stopScrubbing);
    document.removeEventListener('mouseleave', stopScrubbing);
  };

  scrubberHandle.addEventListener('mousedown', startScrubbing);
  scrubberHandle.addEventListener('touchstart', startScrubbing);

  // --- Первоначальная инициализация ---
  showUploader();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}