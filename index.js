require('dotenv').config();
const express = require('express');
const { Telegraf, Markup, session } = require('telegraf');
const { uploadFile } = require('./googleDrive');
const { appendRow } = require('./sheet');

const { BOT_TOKEN, WEBHOOK_URL, TARGET_CHAT_ID, TARGET_TOPIC_ID } = process.env;
const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

bot.use(session({ defaultSession: () => ({}) }));
const steps = [
  'managers','type','object','address','source','client',
  'contractor','contacts','report','structures','timeline','next','photo'
];
const MANAGERS = [ '@alice','@bob','@charlie' ];

bot.start(ctx => {
  ctx.session.data = {};
  ctx.session.step = 0;
  ctx.reply('Добро пожаловать! Нажмите:', Markup.inlineKeyboard([
    [Markup.button.callback('Добавить отчет', 'NEXT')]
  ]));
});


bot.action('NEXT', ctx => { ctx.answerCbQuery(); askStep(ctx); });

function askStep(ctx) {
  const idx = ctx.session.step;
  const key = steps[idx];
  if (key === 'managers') {
  return ctx.reply('Выберите менеджеров:', Markup.inlineKeyboard([
    ...MANAGERS.map(m => [Markup.button.callback(m, m)]),
    [Markup.button.callback('Готово', 'DONE_MAN')]
  ]));
}
  if (key==='type') return ctx.reply('Тип выезда:', Markup.inlineKeyboard([
    Markup.button.callback('Результативный','TYPE_success'),
    Markup.button.callback('Без результата','TYPE_no'),
    Markup.button.callback('Неактуальный','TYPE_old')
  ]));
  if (key==='next') return ctx.reply('Дальше:', Markup.inlineKeyboard([
    Markup.button.callback('Создать лид','NEXT_lead'),
    Markup.button.callback('Паузу','NEXT_pause')
  ]));
  if (key==='photo') return ctx.reply('Пришлите фото или файл:');
  // текстовые вопросы11
  const questions = {
    object:'Объект:', address:'Адрес:', source:'Источник:', client:'Заказчик:',
    contractor:'Генподрядчик:', contacts:'Контакты:', report:'Отчет:',
    structures:'Конструкции:', timeline:'Сроки:'
  };
  return ctx.reply(questions[key]);
}

bot.action(/@.+/,ctx=>{
  const sel=ctx.match[0];
  ctx.session.data.managers = ctx.session.data.managers||[];
  const idx = ctx.session.data.managers.indexOf(sel);
  if(idx>=0) ctx.session.data.managers.splice(idx,1);
  else ctx.session.data.managers.push(sel);
  ctx.answerCbQuery(`Менеджеры: ${ctx.session.data.managers.join(', ')}`);
});

bot.action('DONE_MAN',ctx=>{ctx.answerCbQuery(); next(ctx);});
bot.action(/TYPE_.+/,ctx=>{ctx.session.data.type=ctx.match[0]; ctx.answerCbQuery(); next(ctx);});
bot.action(/NEXT_.+/,ctx=>{ctx.session.data.nextAction=ctx.match[0]; ctx.answerCbQuery(); next(ctx);});

function next(ctx){ ctx.session.step++; askStep(ctx); }

bot.on(['text','photo','document'], async ctx=>{
  const key=steps[ctx.session.step];
  if(key==='photo'){
    const f = ctx.message.photo?
      ctx.message.photo.pop():ctx.message.document;
    const fileLink = await uploadFile(await ctx.telegram.getFile(f.file_id));
    ctx.session.data.photoLink = fileLink;
  } else ctx.session.data[key]=ctx.message.text;

  ctx.session.step++;
  if(ctx.session.step<steps.length) return askStep(ctx);

  // подтверждение
  const summary = Object.entries(ctx.session.data)
    .map(([k,v])=>`*${k}*: ${Array.isArray(v)?v.join(', '):v}`)
    .join("\n");
  ctx.replyWithMarkdown(`Проверьте:\n${summary}`,
    Markup.inlineKeyboard([
      Markup.button.callback('Подтвердить','CONFIRM'),
      Markup.button.callback('Отмена','CANCEL')
    ]));
});

bot.action('CONFIRM', async ctx=>{
  const row = [ctx.from.username, ...steps.map(k=>Array.isArray(ctx.session.data[k])?ctx.session.data[k].join(', '):ctx.session.data[k])];
  await appendRow(row);
  await ctx.telegram.sendMessage(process.env.TARGET_CHAT_ID,
    `Новый отчет от @${ctx.from.username}`,{ message_thread_id:+process.env.TARGET_TOPIC_ID });
  ctx.reply('Готово!');
});
bot.action('CANCEL',ctx=>ctx.reply('Отмена'));

app.post('/webhook',(req,res)=>bot.handleUpdate(req.body, res));
bot.telegram.setWebhook(WEBHOOK_URL);
app.listen(process.env.PORT||3000,()=>console.log('Running'));

const fs = require('fs');

console.log('Path from env:', process.env.GOOGLE_APPLICATION_CREDENTIALS);

try {
  const content = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
  console.log('File content preview:', content.substring(0, 100));
} catch (e) {
  console.error('Error reading credential file:', e.message);
}

