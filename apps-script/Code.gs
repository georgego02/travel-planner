/**
 * Скрипт записи для «Планировщика поездки».
 * Позволяет с телефона: добавлять идеи и голосовать за них, отмечать собранные вещи
 * и сделанные дела, добавлять и удалять расходы.
 *
 * Установка (один раз, делает владелец таблицы):
 *   1. Откройте таблицу → Расширения → Apps Script.
 *   2. Удалите всё в файле Code.gs и вставьте этот код целиком. Сохраните.
 *   3. При желании поменяйте FAMILY_CODE ниже — это код, который участники введут на телефоне.
 *   4. «Развернуть» → «Новое развертывание» → тип «Веб-приложение».
 *      Выполнять как: «Я». У кого есть доступ: «Все». → «Развернуть» → разрешить доступ.
 *   5. Скопируйте URL веб-приложения (…/exec) в config.js → SCRIPT_URL.
 *
 * После изменения кода: «Развернуть» → «Управление развертываниями» → карандаш →
 * версия «Новая» → «Развернуть». URL остаётся прежним.
 */

const FAMILY_CODE = "tirol-7422";

const TABS = { packing: "Сборы", ideas: "Идеи", expenses: "Расходы", tasks: "Подготовка" };
const HEADERS = {
  packing: ["Вещь", "Категория", "Кто берёт", "Взято"],
  ideas: ["Идея", "Автор", "Комментарий", "Голоса"],
  tasks: ["Дело", "До", "Кто", "Готово", "Ссылка", "Заметка"],
  expenses: ["ID", "Дата", "Сумма", "Валюта", "Категория", "Описание", "Добавил"],
};

function doGet() {
  return json({ ok: true, service: "trip-planner" });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return json({ ok: false, error: "Неверный запрос" }); }

  if (String(req.code || "").trim().toLowerCase() !== FAMILY_CODE.toLowerCase()) {
    return json({ ok: false, auth: false, error: "Неверный семейный код" });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const d = req.data || {};

    switch (req.action) {
      case "ping":
        return json({ ok: true });

      case "addIdea": {
        const idea = clean(d.idea, 300);
        if (!idea) return json({ ok: false, error: "Пустая идея" });
        const sh = sheet(ss, "ideas");
        if (d.id && findRow(sh, "Идея", idea)) return json({ ok: true, duplicate: true });
        appendRow(sh, { "Идея": idea, "Автор": clean(d.author, 60), "Комментарий": clean(d.comment, 500) });
        return json({ ok: true });
      }

      case "setPacked": {
        const sh = sheet(ss, "packing");
        const row = findRow(sh, "Вещь", clean(d.item, 200));
        if (!row) return json({ ok: false, error: "Вещь не найдена в таблице" });
        setCell(sh, row, "Взято", d.done ? "Да" : "Нет");
        return json({ ok: true });
      }

      case "setTask": {
        const sh = sheet(ss, "tasks");
        const row = findRow(sh, "Дело", clean(d.task, 300));
        if (!row) return json({ ok: false, error: "Дело не найдено в таблице" });
        setCell(sh, row, "Готово", d.done ? "Да" : "Нет");
        return json({ ok: true });
      }

      case "voteIdea": {
        const sh = sheet(ss, "ideas");
        const name = clean(d.name, 40);
        if (!name) return json({ ok: false, error: "Укажите имя в настройках сайта" });
        const row = findRow(sh, "Идея", clean(d.idea, 300));
        if (!row) return json({ ok: false, error: "Идея не найдена в таблице" });
        let col = headerMap(sh)["Голоса"];
        if (!col) {                              // старая таблица без столбца — добавляем
          col = sh.getLastColumn() + 1;
          sh.getRange(1, col).setValue("Голоса").setFontWeight("bold");
        }
        const cell = sh.getRange(row, col);
        const voters = String(cell.getDisplayValue() || "").split(",").map(function (v) { return v.trim(); }).filter(String);
        const has = voters.some(function (v) { return v.toLowerCase() === name.toLowerCase(); });
        const next = d.on ? (has ? voters : voters.concat([name])) : voters.filter(function (v) { return v.toLowerCase() !== name.toLowerCase(); });
        cell.setNumberFormat("@").setValue(next.join(", "));
        return json({ ok: true, votes: next.length });
      }

      case "addExpense": {
        const amount = Number(String(d.amount).replace(",", "."));
        if (!(amount > 0)) return json({ ok: false, error: "Некорректная сумма" });
        const sh = sheet(ss, "expenses");
        const id = clean(d.id, 40) || Utilities.getUuid().slice(0, 8);
        if (findRow(sh, "ID", id)) return json({ ok: true, id: id, duplicate: true }); // повторная отправка из очереди
        appendRow(sh, {
          "ID": id,
          "Дата": clean(d.date, 20),
          "Сумма": String(Math.round(amount * 100) / 100),
          "Валюта": clean(d.currency, 8).toUpperCase(),
          "Категория": clean(d.category, 40),
          "Описание": clean(d.note, 300),
          "Добавил": clean(d.author, 60),
        });
        return json({ ok: true, id: id });
      }

      case "deleteExpense": {
        const sh = sheet(ss, "expenses");
        const row = findRow(sh, "ID", clean(d.id, 40));
        if (row) sh.deleteRow(row);
        return json({ ok: true });
      }

      default:
        return json({ ok: false, error: "Неизвестное действие" });
    }
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

// ---------- вспомогательные функции ----------

function sheet(ss, key) {
  let sh = ss.getSheetByName(TABS[key]);
  if (!sh) {                                   // вкладки нет — создаём с заголовками
    sh = ss.insertSheet(TABS[key]);
    sh.getRange(1, 1, 1, HEADERS[key].length).setValues([HEADERS[key]]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}

function headerMap(sh) {
  const width = Math.max(sh.getLastColumn(), 1);
  const head = sh.getRange(1, 1, 1, width).getDisplayValues()[0];
  const map = {};
  head.forEach(function (v, i) { if (v !== "") map[String(v).trim()] = i + 1; });
  return map;
}

function appendRow(sh, obj) {
  const map = headerMap(sh);
  const width = Math.max(sh.getLastColumn(), 1);
  const row = [];
  for (let i = 0; i < width; i++) row.push("");
  Object.keys(obj).forEach(function (k) { if (map[k]) row[map[k] - 1] = obj[k]; });
  const range = sh.getRange(sh.getLastRow() + 1, 1, 1, width);
  range.setNumberFormat("@");                  // всё как текст — сайт читает одинаково
  range.setValues([row]);
}

function findRow(sh, column, value) {
  if (!value) return 0;
  const col = headerMap(sh)[column];
  const last = sh.getLastRow();
  if (!col || last < 2) return 0;
  const values = sh.getRange(2, col, last - 1, 1).getDisplayValues();
  const needle = String(value).trim().toLowerCase();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim().toLowerCase() === needle) return i + 2;
  }
  return 0;
}

function setCell(sh, row, column, value) {
  const col = headerMap(sh)[column];
  if (col) sh.getRange(row, col).setNumberFormat("@").setValue(value);
}

function clean(v, max) {
  let s = String(v == null ? "" : v).replace(/[\r\n\t]+/g, " ").trim().slice(0, max || 200);
  if (/^[=+@]/.test(s)) s = "'" + s;           // защита от формул
  return s;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
