import logger from './utils/logger';
import { registerFunctionsOnClassString } from './utils/string.util';
import { cronProvider } from './providers/cron.provider';

registerFunctionsOnClassString();

const unexpectedErrorHandler = (error: Error): void => {
  logger.error('An unexpected error occurred', { message: error.message, stack: error.stack });
  exitHandler();
};

const exitHandler = (): void => {
  logger.info('Shutting down gracefully');
  process.exit(0);
};

const initializeJobScheduler = (): void => {
  logger.info('Database connected');
  cronProvider.register();

  process.on('uncaughtException', unexpectedErrorHandler);
  process.on('unhandledRejection', unexpectedErrorHandler);
};
initializeJobScheduler();
