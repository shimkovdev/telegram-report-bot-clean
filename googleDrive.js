const { google } = require('googleapis');
const axios = require('axios');
const path = require('path');

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/drive']
});

const drive = google.drive({ version: 'v3', auth });

async function uploadFile(file) {
  const ext = file.file_name ? path.extname(file.file_name) : '.jpg';
  const fileName = `${file.file_unique_id || file.file_id}${ext}`;
  const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

  const response = await axios.get(fileUrl, { responseType: 'stream' });

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [process.env.DRIVE_FOLDER_ID]
    },
    media: {
      mimeType: file.mime_type || 'image/jpeg',
      body: response.data
    }
  });

  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: {
      role: 'reader',
      type: 'anyone'
    }
  });

  return `https://drive.google.com/file/d/${res.data.id}/view`;
}

module.exports = { uploadFile };


