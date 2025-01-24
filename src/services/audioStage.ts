import { AppDataSource } from '../config';
import { AudioStage } from '../models/audioStage';
import logger from '../utils/logger';

export const audioStageMetaData = async (whereClause: any): Promise<any> => {
  try {
    const Audios = await AudioStage.findAll({ where: whereClause });
    const audios = Audios.map((qs) => qs.dataValues);
    return audios;
  } catch (error) {
    logger.error(error);
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to get all record' : '';
    return { error: true, message: errorMsg };
  }
};

export const createAudioStage = async (insertData: Array<Record<string, any>>): Promise<any> => {
  const transact = await AppDataSource.transaction();
  try {
    const stagingData = await AudioStage.bulkCreate(insertData, { transaction: transact });
    await transact.commit();
    const [dataValues] = stagingData;
    return { error: false, dataValues };
  } catch (error: any) {
    const fields = error?.fields;
    await transact.rollback();
    logger.error(error?.message);
    return { error: true, message: `${error?.original?.message} ${fields ? JSON.stringify(fields) : ''}`.trim() };
  }
};
