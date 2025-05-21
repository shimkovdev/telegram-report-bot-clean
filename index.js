require('dotenv').config();
const express = require('express');
const { Telegraf, Markup, session } = require('telegraf');
const { uploadFile } = require('./googleDrive');
const { appendRow } = require('./sheet');
const fs = require('fs');

const { BOT_TOKEN, WEBHOOK_URL, TARGET_CHAT_ID, TARGET_TOPIC_ID } = process.env;
const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

bot.use(session({ defaultSession: () => ({}) }));

bot.use((ctx, next) => {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.data) ctx.session.data = {};
  if (typeof ctx.session.step !== 'number') ctx.session.step = 0;
  return next();
});

const steps = [
  'managers', 'type', 'object', 'address', 'source', 'client',
  'contractor', 'contacts', 'report', 'structures', 'timeline', 'next', 'photo'
];

const MANAGERS = ['@alice', '@bob', '@charlie'];

const QUESTIONS = {
  managers: '👤 Менеджеры',
  type: '📌 Тип выезда',
  object: '🏗 Объект',
  address: '📍 Адрес',
  source: '🔎 Источник',
  client: '👤 Заказчик',
  contractor: '🏢 Генподрядчик',
  contacts: '📞 Контакты',
  report: '📝 Отчет',
  structures: '🏗 Конструкции',
  timeline: '⏳ Сроки',
  next: '🧭 Дальнейшие действия',
  photo: '📎 Фото/файл',
};

bot.start(ctx => {
  ctx.session.data = {};
  ctx.session.step = 0;
  ctx.reply(
    '👋 *Добро пожаловать!*\n\nЧтобы добавить отчет, нажмите кнопку ниже.',
    Markup.inlineKeyboard([
      [Markup.button.callback('➕ Добавить отчет', 'NEXT')]
    ]),
    { parse_mode: 'Markdown' }
  );
});

bot.action('NEXT', ctx => {
  ctx.answerCbQuery();
  askStep(ctx);
});

function getManagerKeyboard(selected = []) {
  return Markup.inlineKeyboard([
    ...MANAGERS.map(m => [
      Markup.button.callback(`${selected.includes(m) ? '✅' : '❌'} ${m}`, m)
    ]),
    [Markup.button.callback('✅ Готово', 'DONE_MAN')]
  ]);
}

function askStep(ctx) {
  const idx = ctx.session.step;
  const key = steps[idx];

  if (key === 'managers') {
    return ctx.reply('👤 Выберите менеджеров:', getManagerKeyboard(ctx.session.data.managers || []));
  }

  if (key === 'type') return ctx.reply('📌 Тип выезда:', Markup.inlineKeyboard([
    Markup.button.callback('✅ Результативный', 'TYPE_success'),
    Markup.button.callback('❌ Без результата', 'TYPE_no'),
    Markup.button.callback('📂 Неактуальный', 'TYPE_old')
  ]));

  if (key === 'next') return ctx.reply('🧭 Дальше:', Markup.inlineKeyboard([
    Markup.button.callback('🟢 Создать лид', 'NEXT_lead'),
    Markup.button.callback('⏸ В Менопаузу', 'NEXT_pause')
  ]));

  if (key === 'photo') return ctx.reply('📎 Пришлите фото или файл:');

  return ctx.reply(QUESTIONS[key] + ':');
}

// Менеджеры
bot.action(/@.+/, ctx => {
  const sel = ctx.match[0];
  const managers = ctx.session.data.managers || [];
  const idx = managers.indexOf(sel);
  if (idx >= 0) managers.splice(idx, 1);
  else managers.push(sel);
  ctx.session.data.managers = managers;
  ctx.answerCbQuery(`Менеджеры: ${managers.join(', ')}`);
  ctx.editMessageReplyMarkup(getManagerKeyboard(managers).reply_markup);
});

bot.action('DONE_MAN', ctx => {
  ctx.answerCbQuery();
  next(ctx);
});

bot.action(/TYPE_.+/, ctx => {
  ctx.session.data.type = {
    TYPE_success: 'Результативный',
    TYPE_no: 'Без результата',
    TYPE_old: 'Неактуальный'
  }[ctx.match[0]];
  ctx.answerCbQuery();
  next(ctx);
});

bot.action(/NEXT_.+/, ctx => {
  ctx.session.data.next = {
    NEXT_lead: 'Создать лид',
    NEXT_pause: 'В Менопаузу'
  }[ctx.match[0]];
  ctx.answerCbQuery();
  next(ctx);
});

function next(ctx) {
  ctx.session.step++;
  askStep(ctx);
}

bot.on(['text', 'photo', 'document'], async ctx => {
  const key = steps[ctx.session.step];

  if (key === 'photo') {
    const f = ctx.message.photo ? ctx.message.photo.pop() : ctx.message.document;
    const originalLink = await uploadFile(await ctx.telegram.getFile(f.file_id));
    
    // Преобразуем ссылку в прямую ссылку скачивания Google Drive
    const fileIdMatch = originalLink.match(/\/d\/([^\/]+)/);
    let directLink = originalLink;
    if (fileIdMatch && fileIdMatch[1]) {
      const fileId = fileIdMatch[1];
      directLink = `https://drive.google.com/uc?export=download&id=${fileId}`;
    }
    
    ctx.session.data.photo = directLink;
  } else {
    ctx.session.data[key] = ctx.message.text;
  }

  ctx.session.step++;
  if (ctx.session.step < steps.length) return askStep(ctx);

  // Подтверждение
  const summary = steps.map(k => {
    const val = ctx.session.data[k];
    const value = Array.isArray(val) ? val.join(', ') : val || '-';
    return `*${QUESTIONS[k]}*: ${value}`;
  }).join('\n');

  ctx.replyWithMarkdown(
    `📋 *Проверьте данные перед отправкой:*\n\n${summary}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Подтвердить', 'CONFIRM')],
      [Markup.button.callback('❌ Отмена', 'CANCEL')]
    ])
  );
});

bot.action('CONFIRM', async ctx => {
  const data = ctx.session.data;

  const row = [
    ctx.from.username,
    ...steps.map(k => Array.isArray(data[k]) ? data[k].join(', ') : data[k])
  ];
  await appendRow(row);

  const summary = steps.map(k => {
    const val = data[k];
    const value = Array.isArray(val) ? val.join(', ') : val || '-';
    return `*${QUESTIONS[k]}*: ${value}`;
  }).join('\n');

  if (data.photo) {
    await ctx.telegram.sendPhoto(
      TARGET_CHAT_ID,
      data.photo,  // Здесь уже будет прямой линк
      {
        caption: `📢 *Новый отчет: Поиск объектов: от @${ctx.from.username}:*\n\n${summary}`,
        parse_mode: 'Markdown',
        message_thread_id: +TARGET_TOPIC_ID
      }
    );
  } else {
    await ctx.telegram.sendMessage(
      TARGET_CHAT_ID,
      `📢 *Новый отчет от @${ctx.from.username}:*\n\n${summary}`,
      {
        parse_mode: 'Markdown',
        message_thread_id: +TARGET_TOPIC_ID
      }
    );
  }

  ctx.reply('✅ *Отчет отправлен!* Спасибо!', { parse_mode: 'Markdown' });
});

app.get('/', (req, res) => {
  res.send('✅ Bot is alive');
});


bot.action('CANCEL', ctx => ctx.reply('❌ Отправка отменена.'));

app.post('/webhook', (req, res) => bot.handleUpdate(req.body, res));
bot.telegram.setWebhook(WEBHOOK_URL);
app.listen(process.env.PORT || 3000, () => console.log('Running'));

console.log('Path from env:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
try {
  const content = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
  console.log('File content preview:', content.substring(0, 100));
} catch (e) {
  console.error('Error reading credential file:', e.message);
}

function escapeMarkdown(text = '') {
  return text.replace(/([_*\[\]()~`>#+=|{}.!\\])/g, '\\$1');
}


