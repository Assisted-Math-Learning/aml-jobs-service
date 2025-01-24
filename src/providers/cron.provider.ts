import { appConfiguration } from '../config';
import { Schedule } from '../jobs/job';
import { processJob } from '../jobs/processJob';
import logger from '../utils/logger';

const { processInterval } = appConfiguration;

export class CronProvider {
  private registered = false;
  constructor() {}

  static getInstance(): CronProvider {
    return new CronProvider();
  }

  register() {
    if (this.registered) {
      return;
    }
    this.scheduleJobs();
    this.registered = true;
    logger.info('Cron Jobs Registered');
  }

  private scheduleJobs() {
    Schedule(`*/${processInterval} * * * *`, processJob);
  }
}

processJob()
  .then(() => logger.info('Pre run the event while server startup'))
  .catch((err) => logger.error('Error while pre run the event', err));

export const cronProvider = CronProvider.getInstance();
