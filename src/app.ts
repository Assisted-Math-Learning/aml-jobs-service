import { appConfiguration } from './config';
import logger from './utils/logger';
import { bulkUploadProcess } from './controllers/bulkUpload';
import { registerFunctionsOnClassString } from './utils/string.util';
let isJobRunning = false;

const { processInterval } = appConfiguration;

registerFunctionsOnClassString();

const unexpectedErrorHandler = (error: Error): void => {
  logger.error('An unexpected error occurred', { message: error.message, stack: error.stack });
  exitHandler();
};

const exitHandler = (): void => {
  logger.info('Shutting down gracefully');
  process.exit(0);
};

const processJob = async (): Promise<void> => {
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

const initializeJobScheduler = (): void => {
  logger.info('Database connected');
  setInterval(() => {
    void processJob();
  }, processInterval);

  process.on('uncaughtException', unexpectedErrorHandler);
  process.on('unhandledRejection', unexpectedErrorHandler);
};
// pre run on server startup
processJob()
  .then(() => logger.info('Pre run the event while server startup'))
  .catch((err) => logger.error('Error while pre run the event', err));
initializeJobScheduler();
