const { Telegraf } = require('telegraf');
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.on('message', (ctx) => ctx.reply('Бот работает.'));

bot.launch().then(() => console.log('Бот запущен!'));
