import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { appConfiguration } from '../config';
import logger from '../utils/logger';
import path from 'path';
import mime from 'mime-types';

const {
  bucketName,
  aws: { accessKey, secretKey, bucketRegion },
} = appConfiguration;

const s3Client = new S3Client({
  region: bucketRegion,
  credentials: {
    secretAccessKey: secretKey,
    accessKeyId: accessKey,
  },
});

export const getAWSFolderData = async (filePath: string) => {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: filePath,
  });
  const response = await s3Client.send(command);
  logger.info('stream object get from cloud');
  return response.Body;
};
export const uploadMediaFile = async (filesData: any, type: string) => {
  const filepath = path.extname(filesData.entryName);
  const fileMimeType = mime.lookup(filepath) || 'application/octet-stream';
  const fileName = filesData.entryName.split('/')[1];
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: `media/${type}/${fileName}`,
    Body: filesData.getData(),
  });
  await s3Client.send(command);
  return { file_name: fileName, src: `media/${type}`, mime_type: fileMimeType, mediaType: fileMimeType.split('/')[0] };
};

export const uploadCsvFile = async (filesData: any, fileName: string) => {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    Body: filesData,
    ContentType: 'text/csv',
  });
  const fileUpload = await s3Client.send(command);
  return fileUpload;
};

export const getAWSFolderMetaData = async (folderPath: string) => {
  try {
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: folderPath,
    });

    const s3Objects = await s3Client.send(command);
    const { Contents } = s3Objects;
    return { error: false, Contents, message: 'success' };
  } catch (error) {
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to get all folder' : '';
    return { error: true, message: errorMsg };
  }
};
