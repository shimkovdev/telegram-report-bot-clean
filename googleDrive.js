const { Storage } = require('@google-cloud/storage');
const path = require('path');

// Автоматически подтянет переменную GOOGLE_APPLICATION_CREDENTIALS
const storage = new Storage();
const bucketName = process.env.DRIVE_FOLDER_ID;

// Загрузка файла и получение публичной ссылки
async function uploadFile(file) {
  // file.file_id и file.file_unique_id
  const fileId = file.file_id;
  const ext = file.file_name ? path.extname(file.file_name) : '.jpg';
  const destName = `${file.unique_id || fileId}${ext}`;

  const buffer = await (await require('axios')({
    url: `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`,
    responseType: 'arraybuffer'
  })).data;

  const fileUpload = storage.bucket(bucketName).file(destName);
  await fileUpload.save(buffer, { resumable: false });
  await fileUpload.makePublic();
  return `https://storage.googleapis.com/${bucketName}/${destName}`;
}

module.exports = { uploadFile };