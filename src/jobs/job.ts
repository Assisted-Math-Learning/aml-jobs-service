import { CronJob } from 'cron';

/**
 * Register jobs in cron.provider.ts
 * @param cronTime
 * @param job
 * @constructor
 */
export function Schedule(cronTime: string, job: any) {
  CronJob.from({
    cronTime,
    onTick: job,
    start: true,
    timeZone: 'Asia/Kolkata',
  });
}
