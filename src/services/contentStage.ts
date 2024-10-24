import { AppDataSource } from '../config';
import { ContentStage } from '../models/contentStage';
import logger from '../utils/logger';

export const createContentStage = async (insertData: Array<Record<string, any>>): Promise<any> => {
  const transact = await AppDataSource.transaction();
  try {
    const stagingData = await ContentStage.bulkCreate(insertData, { transaction: transact });
    await transact.commit();
    const [dataValues] = stagingData;
    return { dataValues };
  } catch (error: any) {
    await transact.rollback();
    logger.error(error.message);
    return { error: true, message: error.message };
  }
};

export const contentStageMetaData = async (whereClause: any): Promise<any> => {
  try {
    const Contents = await ContentStage.findAll({ where: whereClause });
    const contents = Contents.map((c) => c.dataValues);
    return contents;
  } catch (error) {
    logger.error(error);
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to get a record' : '';
    return { error: true, message: errorMsg };
  }
};

export const updateContentStage = async (whereClause: any, updateObj: any): Promise<any> => {
  const transact = await AppDataSource.transaction();
  try {
    const updateContent = await ContentStage.update(updateObj, { where: whereClause, transaction: transact });
    await transact.commit();
    return { error: false, updateContent };
  } catch (error) {
    await transact.rollback();
    logger.error(error);
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to update a record' : '';
    return { error: true, message: errorMsg };
  }
};

export const getAllStageContent = async (): Promise<any> => {
  try {
    const Contents = await ContentStage.findAll({});
    const contents = Contents.map((c) => c.dataValues);
    return contents;
  } catch (error) {
    logger.error(error);
    const err = error instanceof Error;
    const errorMsg = err ? error.message || 'failed to get All  a record' : '';
    return { error: true, message: errorMsg };
  }
};
