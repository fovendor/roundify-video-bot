// [ИЗМЕНЕНИЕ] Весь код обернут в функцию init, чтобы гарантировать порядок выполнения

const initApp = () => {
  // --- DOM элементы ---
  const fileInput = document.getElementById('fileInput');
  const touchMeContainer = document.getElementById('touchMeContainer');
  const playerWrapper = document.getElementById('playerWrapper');
  const videoPreview = document.getElementById('videoPreview');
  const videoOverlay = document.getElementById('videoOverlay');
  const deleteButton = document.getElementById('deleteButton');
  const convertButton = document.getElementById('convertButton');

  // --- Проверка на наличие элементов ---
  // Эта проверка — ключ к решению проблемы `TypeError`
  if (!fileInput || !touchMeContainer || !playerWrapper || !videoPreview || !deleteButton || !convertButton) {
    console.error('Критическая ошибка: один или несколько HTML-элементов не найдены. Проверьте ID в index.html');
    return; // Прекращаем выполнение, если чего-то не хватает
  }

  // --- Переменные состояния ---
  let videoFile = null;
  let videoObjectURL = null;

  // --- Функции переключения UI ---
  const showPlayer = () => {
    touchMeContainer.classList.add('hidden');
    playerWrapper.classList.remove('hidden');
  };

  const showUploader = () => {
    if (videoObjectURL) {
      URL.revokeObjectURL(videoObjectURL);
    }
    videoPreview.src = '';
    videoObjectURL = null;
    videoFile = null;
    fileInput.value = '';
    convertButton.disabled = true;
    playerWrapper.classList.add('hidden');
    touchMeContainer.classList.remove('hidden');
  };

  // --- Обработчики событий ---
  fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file || !file.type.startsWith('video/')) {
      return;
    }
    videoFile = file;
    videoObjectURL = URL.createObjectURL(videoFile);
    videoPreview.src = videoObjectURL;
    videoPreview.load();
  });

  videoPreview.addEventListener('loadedmetadata', () => {
    showPlayer();
    videoOverlay.classList.remove('hidden');
  });

  videoPreview.addEventListener('click', () => {
    if (videoPreview.paused) {
      videoPreview.play();
    } else {
      videoPreview.pause();
    }
  });

  videoPreview.addEventListener('play', () => {
    videoOverlay.classList.add('hidden');
  });
  videoPreview.addEventListener('pause', () => {
    videoOverlay.classList.remove('hidden');
  });

  deleteButton.addEventListener('click', () => {
    showUploader();
  });

  // --- Первоначальная инициализация ---
  showUploader();
};

// [ИЗМЕНЕНИЕ] Используем 'DOMContentLoaded' для вызова нашей основной функции initApp
// Это самый надежный способ дождаться готовности страницы.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}