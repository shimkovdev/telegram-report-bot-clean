const { google } = require('googleapis');

// Авторизация через сервисный аккаунт
const auth = new google.auth.GoogleAuth({
  keyFile: 'gcp-credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = process.env.SHEET_ID;

async function appendRow(values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Лист1!A:Z',
    valueInputOption: 'RAW',
    requestBody: { values: [values] }
  });
}

module.exports = { appendRow };