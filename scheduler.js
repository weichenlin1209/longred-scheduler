(function (root) {
  const DAY_START_MINUTES = 18 * 60;
  const SLOT_MINUTES = 30;
  const SLOTS_PER_DAY = 6;
  const SLOT_CAPACITY = 3;

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const source = text.replace(/^\uFEFF/, '');

    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      if (quoted) {
        if (char === '"' && source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && source[i + 1] === '\n') i += 1;
        row.push(field);
        if (row.some((cell) => cell.trim() !== '')) rows.push(row);
        row = [];
        field = '';
      } else {
        field += char;
      }
    }
    if (field !== '' || row.length) {
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
    }
    if (quoted) throw new Error('CSV 引號沒有成對，請確認檔案格式。');
    return rows;
  }

  function dateLabel(header) {
    const match = header.match(/\[([^\]]+)\]|（([^）]+)）|\(([^)]+)\)/);
    return match ? (match[1] || match[2] || match[3]).trim() : header.trim();
  }

  function parseTime(value) {
    const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  function availableSlots(value) {
    const normalized = value.trim();
    if (normalized === '都不行' || !normalized) return [];
    if (normalized === '都可以') return Array.from({ length: SLOTS_PER_DAY }, (_, i) => i);

    const slots = new Set();
    for (const range of normalized.split(/[,，]/)) {
      const parts = range.trim().match(/^(\d{1,2}:\d{2})\s*[-~～至]\s*(\d{1,2}:\d{2})$/);
      if (!parts) continue;
      const start = parseTime(parts[1]);
      const end = parseTime(parts[2]);
      if (start === null || end === null || end <= start) continue;
      for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
        const slotStart = DAY_START_MINUTES + slot * SLOT_MINUTES;
        const slotEnd = slotStart + SLOT_MINUTES;
        if (start <= slotStart && end >= slotEnd) slots.add(slot);
      }
    }
    return [...slots].sort((a, b) => a - b);
  }

  function timeLabel(slot) {
    const start = DAY_START_MINUTES + slot * SLOT_MINUTES;
    const end = start + SLOT_MINUTES;
    const format = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    return `${format(start)}-${format(end)}`;
  }

  function findDayColumns(headers) {
    return headers.map((header, index) => ({ header, index }))
      .filter(({ header }) => /總驗時間|可參加時間|可配合時間|可驗時間/.test(header));
  }

  function getDayLabels(text) {
    const rows = parseCsv(text);
    if (!rows.length) throw new Error('CSV 沒有標題列。');
    const dayColumns = findDayColumns(rows[0].map((header) => header.trim()));
    if (!dayColumns.length) throw new Error('找不到日期／可參加時間欄位（例如「總驗時間 [09/29（二）]」）。');
    return dayColumns.map(({ header }) => dateLabel(header));
  }

  function formatDayHeader(day) {
    if (!day.venue) return day.label;
    const weekday = day.label.match(/^(.*)（([^（）]+)）$/);
    return weekday ? `${weekday[1]}（${weekday[2]}、${day.venue}）` : `${day.label}（${day.venue}）`;
  }

  function createSchedule(text, venues) {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error('CSV 沒有歌曲資料。');
    const headers = rows[0].map((header) => header.trim());
    const songIndex = headers.findIndex((header) => /歌曲名稱|歌名/.test(header));
    if (songIndex < 0) throw new Error('找不到「歌曲名稱」欄位，請使用表單回覆匯出的 CSV。');
    const dayColumns = findDayColumns(headers);
    if (!dayColumns.length) throw new Error('找不到日期／可參加時間欄位（例如「總驗時間 [09/29（二）]」）。');

    const days = dayColumns.map(({ header }, day) => ({
      label: dateLabel(header),
      venue: (venues[day] || '').trim(),
      slots: Array.from({ length: SLOTS_PER_DAY }, () => Array(SLOT_CAPACITY).fill(null)),
    }));
    const songs = rows.slice(1).map((cells, index) => {
      const name = (cells[songIndex] || '').trim();
      const availability = new Set();
      dayColumns.forEach(({ index: column }, day) => {
        for (const slot of availableSlots(cells[column] || '')) availability.add(day * SLOTS_PER_DAY + slot);
      });
      return { id: `song-${index}`, name, availability, order: index, assigned: false };
    }).filter((song) => song.name);
    if (!songs.length) throw new Error('CSV 中沒有找到歌曲名稱。');

    const ordered = [...songs].sort((a, b) => a.availability.size - b.availability.size || a.order - b.order);
    for (const song of ordered) {
      for (const candidate of song.availability) {
        const day = Math.floor(candidate / SLOTS_PER_DAY);
        const slot = candidate % SLOTS_PER_DAY;
        const position = days[day].slots[slot].findIndex((entry) => entry === null);
        if (position >= 0) {
          days[day].slots[slot][position] = song;
          song.assigned = true;
          break;
        }
      }
    }

    const scheduleRows = Array.from({ length: SLOTS_PER_DAY }, (_, slot) => ({
      time: timeLabel(slot),
      songsByDay: days.map((day) => day.slots[slot]),
    }));
    return { days, scheduleRows, unassigned: songs.filter((song) => !song.assigned), songCount: songs.length };
  }

  function moveSong(result, songId, targetDay, targetSlot, targetIndex) {
    let source = result.unassigned;
    let sourceDay = -1;
    let sourceSlot = -1;
    let sourceIndex = source.findIndex((song) => song.id === songId);
    if (sourceIndex < 0) {
      for (let day = 0; day < result.days.length; day += 1) {
        for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
          const index = result.days[day].slots[slot].findIndex((song) => song?.id === songId);
          if (index >= 0) {
            source = result.days[day].slots[slot];
            sourceDay = day;
            sourceSlot = slot;
            sourceIndex = index;
            break;
          }
        }
        if (sourceIndex >= 0) break;
      }
    }
    if (sourceIndex < 0 || targetDay < 0 || targetDay >= result.days.length || targetSlot < 0 || targetSlot >= SLOTS_PER_DAY || targetIndex < 0 || targetIndex >= SLOT_CAPACITY) {
      return { moved: false, reason: '找不到歌曲或目標時段。' };
    }

    const destination = result.days[targetDay].slots[targetSlot];
    const sameSlot = sourceDay === targetDay && sourceSlot === targetSlot;
    if (sameSlot && sourceIndex === targetIndex) return { moved: false, reason: '歌曲已在這個位置。' };

    const song = source[sourceIndex];
    const displaced = destination[targetIndex];
    const affected = [];
    if (sameSlot) {
      source[sourceIndex] = displaced;
    } else if (sourceDay < 0) {
      source.splice(sourceIndex, 1);
      if (displaced) result.unassigned.push(displaced);
    } else {
      source[sourceIndex] = displaced;
    }
    destination[targetIndex] = song;
    if (!song.availability.has(targetDay * SLOTS_PER_DAY + targetSlot)) {
      affected.push({ songName: song.name, day: result.days[targetDay].label, time: timeLabel(targetSlot) });
    }
    if (displaced && !sameSlot && sourceDay >= 0 && !displaced.availability.has(sourceDay * SLOTS_PER_DAY + sourceSlot)) {
      affected.push({ songName: displaced.name, day: result.days[sourceDay].label, time: timeLabel(sourceSlot) });
    }
    return {
      moved: true,
      conflict: affected.length > 0,
      conflicts: affected,
      songName: song.name,
      time: timeLabel(targetSlot),
      day: result.days[targetDay].label,
    };
  }

  function escapeCsv(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function toCsv(result) {
    const header = ['時段', ...result.days.map(formatDayHeader)];
    const lines = [header];
    for (const row of result.scheduleRows) {
      const rowCount = Math.max(1, ...row.songsByDay.map((songs) => {
        for (let index = songs.length - 1; index >= 0; index -= 1) {
          if (songs[index]) return index + 1;
        }
        return 0;
      }));
      for (let index = 0; index < rowCount; index += 1) {
        lines.push([
          index === 0 ? row.time : '',
          ...row.songsByDay.map((songs) => songs[index]?.name || ''),
        ]);
      }
    }
    lines.push(['無法排入', ...result.days.map((_, index) => index === 0 ? result.unassigned.map((song) => song.name).join('、') : '')]);
    return `\uFEFF${lines.map((line) => line.map(escapeCsv).join(',')).join('\r\n')}\r\n`;
  }

  const api = { parseCsv, getDayLabels, formatDayHeader, createSchedule, moveSong, toCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LongredScheduler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
