const { BlobServiceClient } = require('@azure/storage-blob');
require('dotenv').config();

const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.STORAGE_CONNECTION);
const containerName = 'visitor-ids';

async function uploadBuffer(containerName, blobName, buffer, mimeType) {
  const containerClient = blobServiceClient.getContainerClient(containerName);
  // Create container if not exists (private by default)
  await containerClient.createIfNotExists();
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.uploadData(buffer, { blobHTTPHeaders: { blobContentType: mimeType } });
  return blockBlobClient.url;
}

module.exports = { uploadBuffer, containerName };
