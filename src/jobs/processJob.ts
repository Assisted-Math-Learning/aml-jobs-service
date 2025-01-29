import { bulkUploadProcess } from '../controllers/bulkUpload';
import logger from '../utils/logger';

let isJobRunning = false;

export const processJob = async (): Promise<void> => {
  if (isJobRunning) {
    logger.info('Job already in progress. Skipping this iteration.');
    return Promise.resolve();
  }

  isJobRunning = true;
  logger.info('Starting the job...');

  try {
    await bulkUploadProcess();
    logger.info('Job completed.');
  } catch (error: any) {
    logger.error('Error during job execution', { message: error.message });
  } finally {
    isJobRunning = false;
  }
};
