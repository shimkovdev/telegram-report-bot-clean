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
  'managers','type','object','address','source','client',
  'contractor','contacts','report','structures','timeline','next','photo'
];

const MANAGERS = ['@alice', '@bob', '@charlie'];

const questions = {
  managers: 'Менеджеры:',
  type: 'Тип выезда:',
  object: 'Объект:', address: 'Адрес:', source: 'Источник:',
  client: 'Заказчик:', contractor: 'Генподрядчик:',
  contacts: 'Контакты:', report: 'Отчет:',
  structures: 'Конструкции:', timeline: 'Сроки:',
  next: 'Дальше:', photo: 'Фото:'
};

const typeLabels = {
  TYPE_success: 'Результативный',
  TYPE_no: 'Без результата',
  TYPE_old: 'Неактуальный'
};

const nextLabels = {
  NEXT_lead: 'Создать лид',
  NEXT_pause: 'Паузу'
};

bot.start(ctx => {
  ctx.session.data = {};
  ctx.session.step = 0;
  ctx.reply('Добро пожаловать! Нажмите:', Markup.inlineKeyboard([
    [Markup.button.callback('Добавить отчет', 'NEXT')]
  ]));
});

bot.action('NEXT', ctx => {
  ctx.answerCbQuery();
  askStep(ctx);
});

function askStep(ctx) {
  const idx = ctx.session.step;
  const key = steps[idx];

  if (key === 'managers') {
    return ctx.reply('Выберите менеджеров:', Markup.inlineKeyboard([
      ...MANAGERS.map(m => [Markup.button.callback(m, m)]),
      [Markup.button.callback('Готово', 'DONE_MAN')]
    ]));
  }

  if (key === 'type') return ctx.reply('Тип выезда:', Markup.inlineKeyboard([
    Markup.button.callback('Результативный','TYPE_success'),
    Markup.button.callback('Без результата','TYPE_no'),
    Markup.button.callback('Неактуальный','TYPE_old')
  ]));

  if (key === 'next') return ctx.reply('Дальше:', Markup.inlineKeyboard([
    Markup.button.callback('Создать лид','NEXT_lead'),
    Markup.button.callback('Паузу','NEXT_pause')
  ]));

  if (key === 'photo') return ctx.reply('Пришлите фото или файл:');

  return ctx.reply(questions[key]);
}

bot.action(/@.+/, ctx => {
  const sel = ctx.match[0];
  const managers = ctx.session.data.managers || [];
  const idx = managers.indexOf(sel);
  if (idx >= 0) managers.splice(idx, 1);
  else managers.push(sel);
  ctx.session.data.managers = managers;
  ctx.answerCbQuery(`Менеджеры: ${managers.join(', ')}`);
});

bot.action('DONE_MAN', ctx => {
  ctx.answerCbQuery();
  next(ctx);
});

bot.action(/TYPE_.+/, ctx => {
  ctx.session.data.type = ctx.match[0];
  ctx.answerCbQuery();
  next(ctx);
});

bot.action(/NEXT_.+/, ctx => {
  ctx.session.data.nextAction = ctx.match[0];
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
    const file = await ctx.telegram.getFile(f.file_id);
    const fileLink = await uploadFile(file);
    ctx.session.data.photoLink = fileLink;
    ctx.session.data.photoId = f.file_id;
  } else {
    ctx.session.data[key] = ctx.message.text;
  }

  ctx.session.step++;
  if (ctx.session.step < steps.length) return askStep(ctx);

  const summary = steps.map(k => {
    let val = ctx.session.data[k];
    if (Array.isArray(val)) val = val.join(', ');
    if (k === 'type') val = typeLabels[val] || val;
    if (k === 'next') val = nextLabels[ctx.session.data.nextAction] || '';
    if (k === 'photo') val = ctx.session.data.photoLink || '—';
    return `*${questions[k]}* ${val}`;
  }).join('\n');

  ctx.replyWithMarkdown(`Проверьте:\n\n${summary}`, Markup.inlineKeyboard([
    Markup.button.callback('Подтвердить', 'CONFIRM'),
    Markup.button.callback('Отмена', 'CANCEL')
  ]));
});

bot.action('CONFIRM', async ctx => {
  const row = [ctx.from.username, ...steps.map(k =>
    Array.isArray(ctx.session.data[k]) ? ctx.session.data[k].join(', ') : ctx.session.data[k]
  )];
  await appendRow(row);

  const summary = steps.map(k => {
    let val = ctx.session.data[k];
    if (Array.isArray(val)) val = val.join(', ');
    if (k === 'type') val = typeLabels[val] || val;
    if (k === 'next') val = nextLabels[ctx.session.data.nextAction] || '';
    if (k === 'photo') return ''; // Не включаем ссылку на фото в текст, фото будет отправлено отдельно
    return `*${questions[k]}* ${val}`;
  }).filter(Boolean).join('\n');

  if (ctx.session.data.photoId) {
    await ctx.telegram.sendPhoto(TARGET_CHAT_ID, ctx.session.data.photoId, {
      caption: `Новый отчет от @${ctx.from.username}\n\n${summary}`,
      parse_mode: 'Markdown',
      message_thread_id: +TARGET_TOPIC_ID
    });
  } else {
    await ctx.telegram.sendMessage(TARGET_CHAT_ID, `Новый отчет от @${ctx.from.username}\n\n${summary}`, {
      parse_mode: 'Markdown',
      message_thread_id: +TARGET_TOPIC_ID
    });
  }

  ctx.reply('Готово!');
});

bot.action('CANCEL', ctx => ctx.reply('Отмена'));

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
