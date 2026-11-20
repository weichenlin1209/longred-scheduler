(() => {
  const fileInput = document.querySelector('#csv-file');
  const dropzone = document.querySelector('#dropzone');
  const fileLabel = document.querySelector('#file-label');
  const fileStatus = document.querySelector('#file-status');
  const venueFields = document.querySelector('#venue-fields');
  const scheduleButton = document.querySelector('#schedule-button');
  const downloadButton = document.querySelector('#download-button');
  const errorMessage = document.querySelector('#error-message');
  const results = document.querySelector('#results');
  const resultsSummary = document.querySelector('#results-summary');
  const scheduleTable = document.querySelector('#schedule-table');
  const scheduleNotice = document.querySelector('#schedule-notice');
  const unassigned = document.querySelector('#unassigned');
  let csvText = '';
  let currentResult = null;
  let draggedSongId = '';

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.hidden = !message;
  }

  async function loadFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
      showError('請選擇 CSV 格式的檔案。');
      return;
    }
    try {
      csvText = await file.text();
      LongredScheduler.parseCsv(csvText);
      const dayLabels = LongredScheduler.getDayLabels(csvText);
      venueFields.replaceChildren(...dayLabels.map((day, index) => {
        const row = element('div', undefined, 'form-row venue-field');
        const label = element('label', `${day} 地點`);
        const input = element('input');
        input.type = 'text';
        input.id = `venue-${index}`;
        input.maxLength = 100;
        input.placeholder = '例如：社辦 / 音樂教室';
        label.htmlFor = input.id;
        row.append(label, input);
        return row;
      }));
      fileLabel.textContent = file.name;
      fileStatus.textContent = '檔案已載入，準備產生排程';
      scheduleButton.disabled = false;
      results.hidden = true;
      showError('');
    } catch (error) {
      csvText = '';
      venueFields.replaceChildren();
      scheduleButton.disabled = true;
      fileStatus.textContent = '檔案讀取失敗';
      showError(error.message || '無法讀取這個 CSV 檔案。');
    }
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function songItem(song, day, slot) {
    const item = element('div', song.name, 'song-item');
    item.draggable = true;
    item.dataset.songId = song.id;
    const eligible = day < 0 || song.availability.has(day * 6 + slot);
    if (!eligible) item.classList.add('is-conflict');
    item.title = eligible ? '拖曳以調整順序或移動時段' : '此歌曲目前排在不可參加的時段';
    return item;
  }

  function render(result) {
    const table = element('table');
    const thead = element('thead');
    const headRow = element('tr');
    headRow.append(element('th', '時段'));
    result.days.forEach((day) => {
      headRow.append(element('th', LongredScheduler.formatDayHeader(day)));
    });
    thead.append(headRow);
    const tbody = element('tbody');
    for (const [slot, row] of result.scheduleRows.entries()) {
      for (let position = 0; position < 3; position += 1) {
        const tr = element('tr', undefined, position === 2 ? 'slot-end' : '');
        if (position === 0) {
          const time = element('td', row.time);
          time.rowSpan = 3;
          time.className = 'time-cell';
          tr.append(time);
        }
        row.songsByDay.forEach((positions, day) => {
          const cell = element('td', undefined, 'song-cell');
          cell.dataset.day = String(day);
          cell.dataset.slot = String(slot);
          cell.dataset.position = String(position);
          const song = positions[position];
          if (song) cell.append(songItem(song, day, slot));
          else cell.append(element('span', '＋', 'empty-slot'));
          tr.append(cell);
        });
        tbody.append(tr);
      }
    }
    table.append(thead, tbody);
    scheduleTable.replaceChildren(table);
    resultsSummary.textContent = `${result.days.map((day) => day.label).join('、')} · 共 ${result.songCount} 首歌`;
    if (result.unassigned.length) {
      const list = element('div', undefined, 'song-list');
      for (const song of result.unassigned) list.append(songItem(song, -1, -1));
      unassigned.replaceChildren(element('strong', `無法排入 · ${result.unassigned.length} 首`), list);
      unassigned.hidden = false;
    } else {
      unassigned.hidden = true;
    }
    results.hidden = false;
  }

  fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));
  for (const eventName of ['dragenter', 'dragover']) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add('is-over');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove('is-over');
    });
  }
  dropzone.addEventListener('drop', (event) => loadFile(event.dataTransfer.files[0]));
  scheduleButton.addEventListener('click', () => {
    try {
      const venues = [...venueFields.querySelectorAll('input')].map((input) => input.value);
      currentResult = LongredScheduler.createSchedule(csvText, venues);
      render(currentResult);
      showError('');
    } catch (error) {
      showError(error.message || '排程失敗，請確認 CSV 格式。');
    }
  });
  downloadButton.addEventListener('click', () => {
    if (!currentResult) return;
    const blob = new Blob([LongredScheduler.toCsv(currentResult)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = element('a');
    link.href = url;
    link.download = 'result.csv';
    link.click();
    URL.revokeObjectURL(url);
  });

  results.addEventListener('dragstart', (event) => {
    const item = event.target.closest('.song-item');
    if (!item) return;
    draggedSongId = item.dataset.songId;
    item.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedSongId);
  });
  results.addEventListener('dragend', (event) => {
    event.target.closest('.song-item')?.classList.remove('is-dragging');
    scheduleTable.querySelectorAll('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target'));
  });
  scheduleTable.addEventListener('dragover', (event) => {
    const cell = event.target.closest('td[data-day]');
    if (!cell || !draggedSongId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    scheduleTable.querySelectorAll('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target'));
    cell.classList.add('is-drop-target');
  });
  scheduleTable.addEventListener('drop', (event) => {
    const cell = event.target.closest('td[data-day]');
    if (!cell || !draggedSongId || !currentResult) return;
    event.preventDefault();
    const day = Number(cell.dataset.day);
    const slot = Number(cell.dataset.slot);
    const position = Number(cell.dataset.position);
    const outcome = LongredScheduler.moveSong(currentResult, draggedSongId, day, slot, position);
    scheduleNotice.hidden = false;
    scheduleNotice.className = `schedule-notice${outcome.conflict ? ' is-warning' : outcome.moved ? ' is-success' : ' is-warning'}`;
    scheduleNotice.textContent = outcome.conflict
      ? `提醒：${outcome.conflicts.map((conflict) => `「${conflict.songName}」在 ${conflict.day} ${conflict.time}`).join('；')} 不符合填寫的時段。`
      : outcome.moved ? `已更新「${outcome.songName}」的排程順序。` : outcome.reason;
    if (outcome.moved) render(currentResult);
    draggedSongId = '';
  });
})();
